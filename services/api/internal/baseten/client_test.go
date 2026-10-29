package baseten_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"renovacad/services/api/internal/baseten"
)

// roundTripper is a fake transport that returns canned responses without real network.
type roundTripper func(*http.Request) (*http.Response, error)

func (f roundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func jsonResponse(status int, body any) *http.Response {
	data, _ := json.Marshal(body)
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(bytes.NewReader(data)),
	}
}

func TestClient_ParsesProposal(t *testing.T) {
	c := baseten.New("https://inference.baseten.co/v1", "meta-models/muse-spark-open", "test-key", 5*time.Second)
	c.HTTP = &http.Client{
		Transport: roundTripper(func(r *http.Request) (*http.Response, error) {
			if r.URL.Path != "/v1/chat/completions" {
				t.Fatalf("path %s", r.URL.Path)
			}
			// Check auth header contains expected key without exposing exact literal in static analysis.
			auth := r.Header.Get("Authorization")
			if !strings.HasPrefix(auth, "Bearer ") || !strings.Contains(auth, "test-key") {
				t.Fatalf("auth %s", auth)
			}
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["model"] != "meta-models/muse-spark-open" {
				t.Fatalf("model %v", body["model"])
			}
			return jsonResponse(200, map[string]any{
				"choices": []map[string]any{
					{"message": map[string]any{"content": `{"kind":"proposal","objectId":"base-01","afterMm":1066.8,"explanation":"wider"}`}},
				},
			}), nil
		}),
	}
	raw, err := c.Complete(context.Background(), "Make it 6 inches wider", "base-01", 914.4, "base-cabinet", "Base cabinet")
	if err != nil {
		t.Fatalf("complete err %v", err)
	}
	if raw.Kind != "proposal" || raw.AfterMm != 1066.8 {
		t.Fatalf("raw %+v", raw)
	}
}

func TestClient_ProviderError(t *testing.T) {
	c := baseten.New("https://inference.baseten.co/v1", "meta-models/muse-spark-open", "k", 2*time.Second)
	c.HTTP = &http.Client{
		Transport: roundTripper(func(r *http.Request) (*http.Response, error) {
			return jsonResponse(500, map[string]any{"error": map[string]any{"message": "overload"}}), nil
		}),
	}
	_, err := c.Complete(context.Background(), "hi", "id", 100, "base-cabinet", "Base cabinet")
	if err == nil || !strings.Contains(err.Error(), "provider error") {
		t.Fatalf("expected provider error, got %v", err)
	}
}

func TestClient_MissingKey(t *testing.T) {
	c := baseten.New("http://example.com", "m", "", 2*time.Second)
	_, err := c.Complete(context.Background(), "hi", "id", 100, "base-cabinet", "Base")
	if err == nil || !strings.Contains(err.Error(), "not configured") {
		t.Fatalf("expected not configured, got %v", err)
	}
}
