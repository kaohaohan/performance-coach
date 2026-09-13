package accountdeletion

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
)

// HandleDelete is DELETE /api/v1/me. It must sit behind
// authn.TombstoneRetryMiddleware.
func HandleDelete(svc *Service) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := authn.UserFromContext(r.Context())
		if !ok {
			authn.WriteError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing or invalid authentication")
			return
		}

		code, err := parseDeleteMeBody(r.Body)
		if err != nil {
			authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", "malformed JSON body")
			return
		}

		if err := svc.DeleteMe(r.Context(), user, code); err != nil {
			var inv *InvalidArgumentError
			switch {
			case errors.As(err, &inv):
				authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", inv.Message)
			case errors.Is(err, ErrRecentAuthRequired):
				authn.WriteError(w, http.StatusForbidden, "RECENT_AUTH_REQUIRED", "recent authentication is required")
			default:
				authn.WriteInternalError(w, r, err)
			}
			return
		}

		w.WriteHeader(http.StatusNoContent)
	})
}

func parseDeleteMeBody(body io.Reader) (*string, error) {
	raw, err := io.ReadAll(io.LimitReader(body, 1<<16))
	if err != nil {
		return nil, err
	}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return nil, nil
	}
	if trimmed[0] != '{' {
		return nil, errors.New("accountdeletion: request body must be a JSON object")
	}

	dec := json.NewDecoder(bytes.NewReader(trimmed))
	dec.DisallowUnknownFields()
	var req struct {
		AppleAuthorizationCode *string `json:"appleAuthorizationCode"`
	}
	if err := dec.Decode(&req); err != nil {
		return nil, err
	}
	if dec.More() {
		return nil, errors.New("accountdeletion: unexpected trailing JSON")
	}
	if req.AppleAuthorizationCode != nil {
		code := strings.TrimSpace(*req.AppleAuthorizationCode)
		req.AppleAuthorizationCode = &code
	}
	return req.AppleAuthorizationCode, nil
}
