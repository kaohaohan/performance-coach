// Package progress is the training-progress comparison engine
// (docs/go-backend-api-contract-v0.1.md §3.10, docs/tasks/2026-10-04-training-history.md).
//
// It is pure: no I/O, no clock, no database. Callers load one athlete's
// COMPLETED exposures of one exercise and pass them in; the package returns
// per-exposure metrics and the five objective events. It never grades,
// scores, or labels progress.
package progress

import (
	"math"
	"sort"
)

// Event types, exactly as named in contract §3.10.
const (
	EventLoadPR     = "LOAD_PR"
	EventRepPR      = "REP_PR"
	EventLoadChange = "LOAD_CHANGE"
	EventMatched    = "MATCHED"
	EventRepsDown   = "REPS_DOWN"
)

// Set is one logged set. Load is nil for bodyweight sets (Unit is then
// ignored).
type Set struct {
	SetNumber int
	Load      *float64
	Unit      string
	Reps      int
	RIR       *float64
}

// Exposure is one session's work on the exercise.
type Exposure struct {
	Date     string // YYYY-MM-DD, passed through untouched
	Position int    // exercise position in that day's workout (context only)
	Sets     []Set
}

// TopSet is the set that represents an exposure.
type TopSet struct {
	Load *float64 `json:"load"`
	Reps int      `json:"reps"`
	RIR  *float64 `json:"rir,omitempty"`
}

// Event is one objective comparison result.
type Event struct {
	Type         string   `json:"type"`
	Load         *float64 `json:"load,omitempty"`
	Unit         string   `json:"unit,omitempty"`
	Reps         *int     `json:"reps,omitempty"`
	PreviousReps *int     `json:"previousReps,omitempty"`
	Delta        *float64 `json:"delta,omitempty"`
}

// Result holds the metrics and events of one exposure within one unit.
type Result struct {
	Index        int // index of the exposure in the Analyze input
	Date         string
	Position     int
	Unit         string // "" for bodyweight
	TopSet       TopSet
	Estimated1RM *float64 // top set only; nil for bodyweight or when RIR is unknown
	MaxLoad      *float64
	TotalReps    int
	VolumeLoad   *float64 // Σ load × reps; nil for bodyweight
	SetCount     int
	Events       []Event
}

// Analyze compares exposures given oldest first (input order is chronological
// order). Loads are never converted between units: each exposure's sets are
// split by unit and every unit is analysed as its own series, keyed by unit
// ("kg", "lb"; "" for bodyweight sets). An exposure with no sets in a unit
// does not appear in that unit's series. The first exposure of a series has
// no events.
func Analyze(exposures []Exposure) map[string][]Result {
	type entry struct {
		index int
		date  string
		pos   int
		sets  []Set
	}
	series := map[string][]entry{}
	for i, ex := range exposures {
		byUnit := map[string][]Set{}
		for _, s := range ex.Sets {
			byUnit[unitKey(s)] = append(byUnit[unitKey(s)], s)
		}
		for unit, sets := range byUnit {
			series[unit] = append(series[unit], entry{i, ex.Date, ex.Position, sets})
		}
	}

	out := make(map[string][]Result, len(series))
	for unit, entries := range series {
		// Map iteration above can interleave units but never reorders one
		// unit's entries; keep them chronological regardless.
		sort.SliceStable(entries, func(a, b int) bool { return entries[a].index < entries[b].index })

		results := make([]Result, 0, len(entries))
		bestRepsAtLoad := map[loadKey]int{} // over all earlier exposures
		var maxLoadSeen *float64
		for n, e := range entries {
			top := topSet(e.sets)
			r := Result{
				Index:        e.index,
				Date:         e.date,
				Position:     e.pos,
				Unit:         unit,
				TopSet:       top,
				Estimated1RM: estimated1RM(top),
				MaxLoad:      maxLoad(e.sets),
				SetCount:     len(e.sets),
				Events:       []Event{},
			}
			for _, s := range e.sets {
				r.TotalReps += s.Reps
			}
			r.VolumeLoad = volumeLoad(e.sets)

			if n > 0 {
				prev := results[n-1]
				r.Events = events(unit, top, e.sets, prev.TopSet, maxLoadSeen, bestRepsAtLoad)
			}
			results = append(results, r)

			for _, s := range e.sets {
				k := keyOf(s.Load)
				if s.Reps > bestRepsAtLoad[k] {
					bestRepsAtLoad[k] = s.Reps
				}
				if s.Load != nil && (maxLoadSeen == nil || *s.Load > *maxLoadSeen) {
					v := *s.Load
					maxLoadSeen = &v
				}
			}
		}
		out[unit] = results
	}
	return out
}

func events(unit string, top TopSet, sets []Set, prev TopSet, maxLoadSeen *float64, bestRepsAtLoad map[loadKey]int) []Event {
	evs := []Event{}
	bodyweight := top.Load == nil

	// LOAD_PR: top-set load above every earlier load.
	if !bodyweight && maxLoadSeen != nil && *top.Load > *maxLoadSeen {
		evs = append(evs, Event{Type: EventLoadPR, Load: ptr(*top.Load), Unit: unit})
	}

	// REP_PR: at a load that has been done before, more reps than ever.
	// One event per load, ascending. A load never done before is not a rep
	// record (a heavier one is a LOAD_PR; a lighter one has nothing to beat).
	bestNow := map[loadKey]int{}
	loads := map[loadKey]*float64{}
	for _, s := range sets {
		k := keyOf(s.Load)
		if s.Reps > bestNow[k] {
			bestNow[k] = s.Reps
		}
		loads[k] = s.Load
	}
	keys := make([]loadKey, 0, len(bestNow))
	for k := range bestNow {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(a, b int) bool { return keys[a].less(keys[b]) })
	for _, k := range keys {
		earlier, seen := bestRepsAtLoad[k]
		if seen && bestNow[k] > earlier {
			ev := Event{Type: EventRepPR, Reps: ptr(bestNow[k])}
			if loads[k] != nil {
				ev.Load = ptr(*loads[k])
				ev.Unit = unit
			}
			evs = append(evs, ev)
		}
	}

	// Comparison with the previous exposure's top set.
	switch {
	case bodyweight:
		// No load to compare: reps only.
		if top.Reps == prev.Reps {
			evs = append(evs, Event{Type: EventMatched})
		} else if top.Reps < prev.Reps && !rirHigher(top.RIR, prev.RIR) {
			evs = append(evs, Event{Type: EventRepsDown, Reps: ptr(top.Reps), PreviousReps: ptr(prev.Reps)})
		}
	case prev.Load == nil || *top.Load != *prev.Load:
		if prev.Load != nil {
			evs = append(evs, Event{Type: EventLoadChange, Delta: ptr(round(*top.Load-*prev.Load, 4)), Unit: unit})
		}
	case top.Reps == prev.Reps:
		evs = append(evs, Event{Type: EventMatched})
	case top.Reps < prev.Reps && !rirHigher(top.RIR, prev.RIR):
		evs = append(evs, Event{Type: EventRepsDown, Reps: ptr(top.Reps), PreviousReps: ptr(prev.Reps)})
	}
	return evs
}

// topSet is the heaviest set; ties go to the most reps, then the lowest set
// number. Bodyweight sets (no load) compare reps only. sets must be non-empty.
func topSet(sets []Set) TopSet {
	best := sets[0]
	for _, s := range sets[1:] {
		if beats(s, best) {
			best = s
		}
	}
	return TopSet{Load: cloneFloat(best.Load), Reps: best.Reps, RIR: cloneFloat(best.RIR)}
}

func beats(a, b Set) bool {
	al, bl := loadOrZero(a.Load), loadOrZero(b.Load)
	if al != bl {
		return al > bl
	}
	if a.Reps != b.Reps {
		return a.Reps > b.Reps
	}
	return a.SetNumber < b.SetNumber
}

func estimated1RM(top TopSet) *float64 {
	if top.Load == nil || top.RIR == nil {
		return nil
	}
	return ptr(round(*top.Load*(1+(float64(top.Reps)+*top.RIR)/30), 2))
}

func maxLoad(sets []Set) *float64 {
	var m *float64
	for _, s := range sets {
		if s.Load != nil && (m == nil || *s.Load > *m) {
			m = ptr(*s.Load)
		}
	}
	return m
}

func volumeLoad(sets []Set) *float64 {
	var total float64
	has := false
	for _, s := range sets {
		if s.Load != nil {
			total += *s.Load * float64(s.Reps)
			has = true
		}
	}
	if !has {
		return nil
	}
	return ptr(round(total, 2))
}

// rirHigher reports whether cur was deliberately easier than prev. Unknown
// RIR on either side cannot show "easier", so it is not higher.
func rirHigher(cur, prev *float64) bool {
	return cur != nil && prev != nil && *cur > *prev
}

// loadKey identifies a load for "reps at load X" lookups; bodyweight is its
// own key.
type loadKey struct {
	bodyweight bool
	load       float64
}

func keyOf(load *float64) loadKey {
	if load == nil {
		return loadKey{bodyweight: true}
	}
	return loadKey{load: *load}
}

func (k loadKey) less(o loadKey) bool {
	if k.bodyweight != o.bodyweight {
		return k.bodyweight
	}
	return k.load < o.load
}

func unitKey(s Set) string {
	if s.Load == nil {
		return ""
	}
	return s.Unit
}

func loadOrZero(l *float64) float64 {
	if l == nil {
		return 0
	}
	return *l
}

func cloneFloat(v *float64) *float64 {
	if v == nil {
		return nil
	}
	return ptr(*v)
}

func ptr[T any](v T) *T { return &v }

func round(v float64, places int) float64 {
	p := math.Pow(10, float64(places))
	return math.Round(v*p) / p
}
