package proposal

import (
	"context"
	"fmt"
	"math"
	"strings"

	"renovacad/services/api/internal/baseten"
	"renovacad/services/api/internal/model"
)

const (
	minWidthMm = 25.4
	maxWidthMm = 10000
)

var supportedCabinet = map[model.ObjectKind]bool{
	model.KindBaseCabinet: true,
	model.KindWallCabinet: true,
	model.KindTallCabinet: true,
}

// Service validates input, calls provider, validates output, returns proposal or clarification.
type Service struct {
	Provider baseten.Provider
}

func (s *Service) Propose(ctx context.Context, req model.ProposeRequest) (model.ProposalResponse, *ServiceError) {
	// --- Request validation (trust boundary) ---
	if err := validateRequest(req); err != nil {
		return model.ProposalResponse{}, err
	}

	selected := findObject(req.Scene.Objects, req.SelectedObjectID)
	if selected == nil {
		return model.ProposalResponse{}, &ServiceError{Code: "invalid_request", Message: "selected object not found in scene", HTTPStatus: 400}
	}
	if !supportedCabinet[selected.Kind] {
		return model.ProposalResponse{}, &ServiceError{Code: "invalid_request", Message: fmt.Sprintf("object kind %q does not support resizing", selected.Kind), HTTPStatus: 400}
	}
	if !isFinite(selected.DimensionsMm.Width) || selected.DimensionsMm.Width < minWidthMm || selected.DimensionsMm.Width > maxWidthMm {
		return model.ProposalResponse{}, &ServiceError{Code: "invalid_request", Message: "selected object has invalid width", HTTPStatus: 400}
	}

	// --- Provider call ---
	raw, err := s.Provider.Complete(ctx, req.Instruction, req.SelectedObjectID, selected.DimensionsMm.Width, string(selected.Kind), selected.Name)
	if err != nil {
		if isTimeout(err) {
			return model.ProposalResponse{}, &ServiceError{Code: "provider_timeout", Message: "AI provider timed out", HTTPStatus: 504}
		}
		if isInvalidProviderResponse(err) {
			return model.ProposalResponse{}, &ServiceError{Code: "invalid_provider_response", Message: "AI provider returned unusable output", HTTPStatus: 502}
		}
		return model.ProposalResponse{}, &ServiceError{Code: "provider_error", Message: "AI provider error", HTTPStatus: 502}
	}

	// --- Provider output validation ---
	kind := strings.TrimSpace(raw.Kind)
	switch kind {
	case "clarification":
		msg := strings.TrimSpace(raw.Message)
		if msg == "" {
			return model.ProposalResponse{}, &ServiceError{Code: "invalid_provider_response", Message: "provider clarification missing message", HTTPStatus: 502}
		}
		if len(msg) > 2000 {
			msg = msg[:2000]
		}
		rev := req.SceneRevision
		return model.ProposalResponse{Kind: "clarification", Message: msg, SceneRevision: &rev}, nil
	case "proposal":
		if raw.ObjectID != req.SelectedObjectID {
			return model.ProposalResponse{}, &ServiceError{Code: "invalid_provider_response", Message: "provider returned wrong objectId", HTTPStatus: 502}
		}
		if !isFinite(raw.AfterMm) {
			return model.ProposalResponse{}, &ServiceError{Code: "invalid_provider_response", Message: "provider afterMm not finite", HTTPStatus: 502}
		}
		after := math.Round(raw.AfterMm*1000) / 1000
		if after < minWidthMm || after > maxWidthMm {
			return model.ProposalResponse{}, &ServiceError{Code: "invalid_provider_response", Message: "provider afterMm out of range", HTTPStatus: 502}
		}
		before := math.Round(selected.DimensionsMm.Width*1000) / 1000
		if math.Abs(after-before) < 0.0005 {
			return model.ProposalResponse{}, &ServiceError{Code: "invalid_provider_response", Message: "provider proposed no change", HTTPStatus: 502}
		}
		expl := strings.TrimSpace(raw.Explanation)
		if expl == "" {
			expl = fmt.Sprintf("Resize %s from %.2f in (%.1f mm) to %.2f in (%.1f mm).", selected.Name, before/25.4, before, after/25.4, after)
		}
		if len(expl) > 2000 {
			expl = expl[:2000]
		}
		return model.ProposalResponse{
			Kind: "proposal",
			Proposal: &model.Proposal{
				ObjectID:      selected.ID,
				ObjectName:    selected.Name,
				Operation:     "resize",
				Dimension:     "width",
				BeforeMm:      before,
				AfterMm:       after,
				Explanation:   expl,
				SceneRevision: req.SceneRevision,
			},
		}, nil
	default:
		return model.ProposalResponse{}, &ServiceError{Code: "invalid_provider_response", Message: "provider returned unknown kind", HTTPStatus: 502}
	}
}

type ServiceError struct {
	Code       string
	Message    string
	HTTPStatus int
}

func (e *ServiceError) Error() string { return e.Code + ": " + e.Message }

func validateRequest(req model.ProposeRequest) *ServiceError {
	if strings.TrimSpace(req.Instruction) == "" {
		return &ServiceError{Code: "invalid_request", Message: "instruction is required", HTTPStatus: 400}
	}
	if len(req.Instruction) > 2000 {
		return &ServiceError{Code: "invalid_request", Message: "instruction too long", HTTPStatus: 400}
	}
	if strings.TrimSpace(req.SelectedObjectID) == "" {
		return &ServiceError{Code: "invalid_request", Message: "selectedObjectId is required", HTTPStatus: 400}
	}
	if len(req.SelectedObjectID) > 128 {
		return &ServiceError{Code: "invalid_request", Message: "selectedObjectId too long", HTTPStatus: 400}
	}
	if req.SceneRevision < 0 {
		return &ServiceError{Code: "invalid_request", Message: "sceneRevision must be >= 0", HTTPStatus: 400}
	}
	if len(req.Scene.Objects) == 0 {
		return &ServiceError{Code: "invalid_request", Message: "scene.objects must contain at least one object", HTTPStatus: 400}
	}
	if len(req.Scene.Objects) > 50 {
		return &ServiceError{Code: "invalid_request", Message: "scene.objects exceeds limit (50)", HTTPStatus: 400}
	}
	for i, o := range req.Scene.Objects {
		if strings.TrimSpace(o.ID) == "" {
			return &ServiceError{Code: "invalid_request", Message: fmt.Sprintf("scene.objects[%d].id is required", i), HTTPStatus: 400}
		}
		if len(o.ID) > 128 {
			return &ServiceError{Code: "invalid_request", Message: fmt.Sprintf("scene.objects[%d].id too long", i), HTTPStatus: 400}
		}
		if strings.TrimSpace(string(o.Kind)) == "" {
			return &ServiceError{Code: "invalid_request", Message: fmt.Sprintf("scene.objects[%d].kind is required", i), HTTPStatus: 400}
		}
		if strings.TrimSpace(o.Name) == "" {
			return &ServiceError{Code: "invalid_request", Message: fmt.Sprintf("scene.objects[%d].name is required", i), HTTPStatus: 400}
		}
		if !isFinite(o.DimensionsMm.Width) || !isFinite(o.DimensionsMm.Height) || !isFinite(o.DimensionsMm.Depth) {
			return &ServiceError{Code: "invalid_request", Message: fmt.Sprintf("scene.objects[%d].dimensionsMm must be finite", i), HTTPStatus: 400}
		}
		if o.DimensionsMm.Width <= 0 || o.DimensionsMm.Height <= 0 || o.DimensionsMm.Depth <= 0 {
			return &ServiceError{Code: "invalid_request", Message: fmt.Sprintf("scene.objects[%d].dimensionsMm must be > 0", i), HTTPStatus: 400}
		}
		if o.DimensionsMm.Width > maxWidthMm || o.DimensionsMm.Height > maxWidthMm || o.DimensionsMm.Depth > maxWidthMm {
			return &ServiceError{Code: "invalid_request", Message: fmt.Sprintf("scene.objects[%d].dimensionsMm exceeds maximum", i), HTTPStatus: 400}
		}
		if !isFinite(o.RotationDegrees) || math.Abs(o.RotationDegrees) > 360 {
			return &ServiceError{Code: "invalid_request", Message: fmt.Sprintf("scene.objects[%d].rotationDegrees out of range", i), HTTPStatus: 400}
		}
		if !isFinite(o.PositionMm.X) || !isFinite(o.PositionMm.Y) || !isFinite(o.PositionMm.Z) {
			return &ServiceError{Code: "invalid_request", Message: fmt.Sprintf("scene.objects[%d].positionMm must be finite", i), HTTPStatus: 400}
		}
		if math.Abs(o.PositionMm.X) > 10000 || math.Abs(o.PositionMm.Y) > 10000 || math.Abs(o.PositionMm.Z) > 10000 {
			return &ServiceError{Code: "invalid_request", Message: fmt.Sprintf("scene.objects[%d].positionMm out of range", i), HTTPStatus: 400}
		}
	}
	// Ensure IDs are unique.
	seen := make(map[string]bool)
	for _, o := range req.Scene.Objects {
		if seen[o.ID] {
			return &ServiceError{Code: "invalid_request", Message: fmt.Sprintf("duplicate object id %q", o.ID), HTTPStatus: 400}
		}
		seen[o.ID] = true
	}
	return nil
}

func findObject(objects []model.SceneObject, id string) *model.SceneObject {
	for i := range objects {
		if objects[i].ID == id {
			return &objects[i]
		}
	}
	return nil
}

func isFinite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

func isTimeout(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "provider timeout") || strings.Contains(msg, "deadline") || strings.Contains(msg, "context deadline")
}

func isInvalidProviderResponse(err error) bool {
	return strings.Contains(err.Error(), "invalid provider response")
}
