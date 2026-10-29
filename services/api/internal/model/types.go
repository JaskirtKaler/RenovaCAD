package model

// Scene types reuse src/workspace.ts conventions. Dimensions and positions are millimeters.
// JSON field names mirror the TypeScript model to avoid a second incompatible schema.

type Dimension string

const (
	DimensionWidth Dimension = "width"
)

type ObjectKind string

const (
	KindBaseCabinet ObjectKind = "base-cabinet"
	KindWallCabinet ObjectKind = "wall-cabinet"
	KindTallCabinet ObjectKind = "tall-cabinet"
	KindWall        ObjectKind = "wall"
	KindSink        ObjectKind = "sink"
)

type DimensionsMm struct {
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
	Depth  float64 `json:"depth"`
}

type PositionMm struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

type SceneObject struct {
	ID              string       `json:"id"`
	Kind            ObjectKind   `json:"kind"`
	Name            string       `json:"name"`
	DimensionsMm    DimensionsMm `json:"dimensionsMm"`
	RotationDegrees float64      `json:"rotationDegrees"`
	PositionMm      PositionMm   `json:"positionMm"`
}

type Scene struct {
	Objects []SceneObject `json:"objects"`
}

type ProposeRequest struct {
	Instruction      string `json:"instruction"`
	SelectedObjectID string `json:"selectedObjectId"`
	SceneRevision    int    `json:"sceneRevision"`
	Scene            Scene  `json:"scene"`
}

type Proposal struct {
	ObjectID      string  `json:"objectId"`
	ObjectName    string  `json:"objectName"`
	Operation     string  `json:"operation"`
	Dimension     string  `json:"dimension"`
	BeforeMm      float64 `json:"beforeMm"`
	AfterMm       float64 `json:"afterMm"`
	Explanation   string  `json:"explanation"`
	SceneRevision int     `json:"sceneRevision"`
}

type ProposalResponse struct {
	Kind     string    `json:"kind"` // "proposal" | "clarification"
	Proposal *Proposal `json:"proposal,omitempty"`
	Message  string    `json:"message,omitempty"`
	// Clarification keeps revision at top-level for uniform client handling.
	SceneRevision *int `json:"sceneRevision,omitempty"`
}

type ErrorEnvelope struct {
	Error ErrorBody `json:"error"`
}

type ErrorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type AnalyzePhotoRequest struct {
	Image AnalyzeImage `json:"image"`
}

type AnalyzeImage struct {
	Name     string `json:"name"`
	MimeType string `json:"mimeType"`
	DataURL  string `json:"dataUrl"`
}

type AnalyzePhotoResponse struct {
	Kind              string   `json:"kind"` // "analysis"
	Description       string   `json:"description"`
	FollowUpQuestions []string `json:"followUpQuestions"`
}

// Photo-to-layout draft (versioned contract)
const LayoutDraftVersion = 1
const MaxLayoutObjects = 8
const MaxLayoutResponseBytes = 64 * 1024

type LayoutDraftRequest struct {
	Image AnalyzeImage `json:"image"`
}

type LayoutObjectDraft struct {
	Kind            ObjectKind   `json:"kind"`
	Name            string       `json:"name"`
	DimensionsMm    DimensionsMm `json:"dimensionsMm"`
	PositionMm      PositionMm   `json:"positionMm"`
	RotationDegrees float64      `json:"rotationDegrees"`
}

type LayoutDraft struct {
	Version           int                 `json:"version"`
	Objects           []LayoutObjectDraft `json:"objects"`
	Description       string              `json:"description"`
	FollowUpQuestions []string            `json:"followUpQuestions"`
	Warnings          []string            `json:"warnings,omitempty"`
	IsApproximate     bool                `json:"isApproximate"`
}

type LayoutDraftResponse struct {
	Kind              string       `json:"kind"` // "layout_draft" | "needs_info"
	Draft             *LayoutDraft `json:"draft,omitempty"`
	Message           string       `json:"message,omitempty"`
	FollowUpQuestions []string     `json:"followUpQuestions,omitempty"`
}
