package progress

import "sort"

// LastSet is one set of the athlete's most recent exposure, as recorded.
type LastSet struct {
	SetNumber int      `json:"setNumber"`
	Load      *float64 `json:"load,omitempty"`
	Unit      string   `json:"unit,omitempty"`
	Reps      int      `json:"reps"`
	RIR       *float64 `json:"rir,omitempty"`
}

// Last is the most recent earlier exposure. It carries no session or SetLog
// ids (contract §3.7 `history`, §3.10 cross-coach masking).
type Last struct {
	Date    string    `json:"date"`
	SetLogs []LastSet `json:"setLogs"`
}

// Best is the most reps seen at one load. Load is nil for bodyweight.
type Best struct {
	Load *float64 `json:"load"`
	Unit string   `json:"unit,omitempty"`
	Reps int      `json:"reps"`
	Date string   `json:"date"`
}

// Baseline is the LAST / PR reference the session screen compares a
// just-logged set against.
type Baseline struct {
	Last           *Last  `json:"last"`
	MaxLoad        *Best  `json:"maxLoad"`
	BestRepsByLoad []Best `json:"bestRepsByLoad"`
}

// BuildBaseline summarises earlier exposures (oldest first) for the live
// session screen. `unit` is the exercise's planned load unit; when empty it
// falls back to the unit of the most recent exposure's loaded sets.
//
// Last is the latest exposure with at least one set, in the units as logged.
// MaxLoad and BestRepsByLoad only consider sets in `unit` (never converted)
// plus bodyweight sets, which appear as load nil. The date of a best is the
// first date that number of reps was reached at that load.
func BuildBaseline(earlier []Exposure, unit string) Baseline {
	b := Baseline{BestRepsByLoad: []Best{}}

	for i := len(earlier) - 1; i >= 0; i-- {
		if len(earlier[i].Sets) == 0 {
			continue
		}
		last := &Last{Date: earlier[i].Date, SetLogs: make([]LastSet, 0, len(earlier[i].Sets))}
		sets := append([]Set(nil), earlier[i].Sets...)
		sort.SliceStable(sets, func(a, c int) bool { return sets[a].SetNumber < sets[c].SetNumber })
		for _, s := range sets {
			ls := LastSet{SetNumber: s.SetNumber, Load: cloneFloat(s.Load), Reps: s.Reps, RIR: cloneFloat(s.RIR)}
			if s.Load != nil {
				ls.Unit = s.Unit
				if unit == "" {
					unit = s.Unit
				}
			}
			last.SetLogs = append(last.SetLogs, ls)
		}
		b.Last = last
		break
	}

	best := map[loadKey]*Best{}
	for _, ex := range earlier {
		for _, s := range ex.Sets {
			if s.Load != nil && s.Unit != unit {
				continue
			}
			k := keyOf(s.Load)
			if cur, ok := best[k]; !ok || s.Reps > cur.Reps {
				nb := &Best{Load: cloneFloat(s.Load), Reps: s.Reps, Date: ex.Date}
				if s.Load != nil {
					nb.Unit = unit
				}
				best[k] = nb
			}
		}
	}
	keys := make([]loadKey, 0, len(best))
	for k := range best {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(a, c int) bool { return keys[a].less(keys[c]) })
	for _, k := range keys {
		b.BestRepsByLoad = append(b.BestRepsByLoad, *best[k])
		if !k.bodyweight {
			m := *best[k] // ascending order: the last loaded key is the heaviest
			b.MaxLoad = &m
		}
	}
	return b
}
