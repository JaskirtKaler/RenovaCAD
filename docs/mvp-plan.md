# RenovaCAD — Kitchen Design MVP Plan

**Status:** Working draft  
**Goal:** Build a macOS desktop prototype that lets homeowners and professionals edit a dimensioned kitchen layout and approve AI-suggested changes to real 3D objects.

## 1. Product goal

RenovaCAD combines:

1. A reference photo of an existing kitchen.
2. An editable 3D layout built from dimensioned objects.
3. An AI assistant that suggests changes to the layout.

The central experience is:

> Select a kitchen object, describe a change in everyday language, review the proposed dimensions, and apply the change to an editable 3D design.

The MVP is a design exploration tool. Users supply or edit dimensions; the application does not infer reliable measurements from a photo or produce construction-ready plans.

## 2. Target demonstration

A successful demonstration follows one project from start to finish:

1. Open a prepared kitchen project containing a room and several cabinets.
2. Import or view a reference photo.
3. Select a cabinet and inspect its dimensions.
4. Ask the assistant: “Make this cabinet 6 inches wider.”
5. Review the current and proposed width.
6. Approve the change and see the 3D cabinet update.
7. Undo and redo the change.
8. Save, close, and reopen the project with the updated layout intact.
9. If available, generate a visual renovation preview and compare it with the reference photo.

The AI-to-CAD edit is the central demonstration. Photo features and rendering support that story.

## 3. MVP scope

### Core features

**Desktop and projects**

- Open a three-panel workspace: Inspector, 3D canvas, and AI Assistant.
- Create a project or open a prepared example.
- Save and reopen a project with its objects, dimensions, and reference assets.
- Show clear feedback when saving, loading, or an AI request fails.

**3D editor**

- Create a simple rectangular room.
- Add, select, move, rotate, resize, and delete at least a base cabinet.
- Support a small set of additional objects: wall, upper cabinet, countertop, and appliance placeholder.
- Enter precise measurements in the inspector.
- Orbit, pan, and zoom the camera.
- Undo and redo object edits.

**AI editing**

- Send a request with the selected object and relevant scene context.
- Return a structured edit proposal.
- Show the proposed change before applying it.
- Validate the proposal and apply it through the same editing system as manual changes.
- Handle unclear requests or invalid proposals without changing the design.

### Features to add after the core is stable

- Import a kitchen photo and switch between photo and CAD views.
- Annotate the photo and save annotations with the project.
- Add basic grid or edge snapping.
- Generate a conceptual kitchen render from the current design and user instructions.
- Resize or collapse side panels.

### Stretch features

- SAM-powered object segmentation.
- Viewport resize handles.
- A full camera orientation cube and orthographic views.
- More object types and richer cabinet details.
- Multiple AI operations in one request.
- Depth estimation or automated photo-to-3D research.

### Outside the MVP

- Automatic, measurement-accurate photo-to-CAD reconstruction.
- Building-code approval or construction documents.
- Professional DWG, DXF, or IFC export.
- Cloud collaboration and user accounts.
- Model fine-tuning.
- Full-home or commercial design.

## 4. Technology and architecture

### Desktop application

**Electron, React, TypeScript, Three.js, and React Three Fiber**

- Electron manages the application window, native file dialogs, and controlled access to local files.
- React manages the workspace, inspector, assistant, and project state.
- Three.js and React Three Fiber display and interact with the 3D scene.
- The 3D scene reflects the project data; dimensions are stored independently of the visual display.

### Project model

Each project contains:

- Project ID, name, and format version.
- Room dimensions and scene objects.
- Each object’s stable ID, type, position, rotation, and dimensions.
- References to imported photos, annotations, and generated images.
- Optional view settings such as camera position.

Store dimensions in millimeters and convert them to inches or feet in the interface. Define the coordinate system and object anchor points before implementing placement so manual edits and AI proposals use the same rules.

Use a versioned project format and safe saving. Choose a project folder or portable archive after deciding how projects should move between computers.

### Editing system

All changes use a common set of validated commands:

- Add object.
- Move object.
- Resize object.
- Rotate object.
- Delete object.

Manual controls and approved AI proposals use the same commands, keeping validation and undo/redo consistent. The first AI demonstration only needs a reliable single-object resize.

### Go service and AI

Use Go with Chi for AI requests and orchestration:

1. Receive the relevant scene data and user request.
2. Call the selected model provider.
3. Return a structured proposal or request clarification.
4. Validate object IDs, operation types, and dimension limits.
5. Recheck the proposal when the user approves it in case the scene has changed.

Local editing should remain usable when an AI provider is unavailable. If the Go service runs alongside the desktop application, it needs controlled startup and shutdown, loopback-only access, and request authentication.

Provider credentials must not be embedded in a distributable application. A private hackathon prototype can use a local development configuration; a public release would need an appropriate authenticated backend for paid model calls.

## 5. Interface

### Left: Design Inspector

- Project name and save status.
- Add-object controls.
- Selected object type and dimensions.
- Position and rotation controls.
- Photo import and annotations when implemented.

### Center: Workspace

- 3D kitchen view with a floor, walls, grid, and simple object geometry.
- Clear selection feedback.
- Controls for CAD, reference photo, and generated preview.
- Camera controls appropriate to the current milestone.

### Right: AI Assistant

- Conversation input and response.
- A proposal card showing the target object and before-and-after values.
- **Apply** and **Cancel** controls.
- Clear errors and requests for clarification.

The assistant does not silently modify geometry. Generated images are labeled as visual concepts because they may not match CAD dimensions.

## 6. AI integration

### First integration: structured edit

Start with:

> “Make the selected cabinet 6 inches wider.”

The model receives the selected cabinet’s ID and dimensions, along with the request. It proposes a resize operation. The application checks the result and displays it for approval.

Test:

- A valid resize.
- A request with ambiguous units.
- A missing or deleted object.
- An invalid or extreme dimension.
- A provider timeout or malformed response.
- A proposal that becomes stale because the object changed before approval.

### Providers

Plan around the proposed hackathon technologies:

- **Muse Spark or Muse Spark Open:** conversational assistance and structured edit proposals.
- **SAM 3.1:** optional photo object segmentation.
- **Muse Image:** conceptual kitchen render previews.
- **Baseten and Modal:** use where their available credits and services support the chosen integrations.

Before relying on an integration, confirm the available credentials, endpoint capabilities, usage limits, credit terms, and submission requirements.

## 7. Development milestones

### Milestone 0 — Confirm the demo and access

- Confirm the demonstration workflow and initial sample kitchen.
- Verify hackathon participation, model access, and credentials.
- Confirm the interface reference and project portability expectations.
- Set up the initial repository structure and development workflow.

**Complete when:** The team knows what the demo must show and which external dependencies are available.

### Milestone 1 — Application and saved project

- Set up the macOS desktop application and three-panel layout.
- Define the first project format and coordinate conventions.
- Create, save, and reopen a simple project.
- Establish the Go service boundary.

**Complete when:** A project containing a room and one cabinet survives closing and reopening.

### Milestone 2 — First real CAD edit

- Render the room and cabinet.
- Select the cabinet and change its dimensions numerically.
- Add camera navigation and undo/redo.
- Route edits through validated commands.

**Complete when:** A user changes a cabinet’s width, sees the geometry update, undoes the edit, and saves the result.

### Milestone 3 — AI-assisted edit

- Connect one verified AI endpoint.
- Implement a structured resize proposal.
- Add proposal review, approval, validation, and error states.
- Revalidate the proposal before applying it.

**Complete when:** A user can request, review, approve, and undo an AI-suggested cabinet resize.

### Milestone 4 — Complete the kitchen workflow

- Add the minimum additional kitchen objects.
- Improve placement and numeric editing.
- Prepare a sample kitchen.
- Add basic snapping if the core workflow is stable.

**Complete when:** The sample kitchen can be navigated and edited reliably without depending on AI availability.

### Milestone 5 — Photos and visualization

- Add photo import and project persistence.
- Add simple annotations if time allows.
- Attempt a realistic render using a verified provider.
- Add segmentation only if the preceding features are stable.

**Complete when:** The strongest available photo or render workflow can be demonstrated without risking the core editor.

### Milestone 6 — Stabilize and submit

- Freeze nonessential features.
- Test the complete workflow on macOS.
- Check save/reopen behavior, AI failure cases, and undo/redo.
- Prepare the sample project, demonstration recording, and submission materials.
- Verify the current submission deadline and requirements.

**Complete when:** The project can be demonstrated from a clean launch and the submission is complete.

## 8. Testing checklist

- New and existing projects open successfully.
- Object dimensions remain accurate after saving and reopening.
- Manual edits and approved AI edits can be undone and redone.
- Invalid dimensions and malformed AI proposals are rejected.
- Canceling a proposal leaves the design unchanged.
- A stale proposal is rechecked before application.
- A failed AI call does not damage the local project.
- Imported photos and annotations remain associated with the project.
- The prepared demo works after restarting the application.
- A generated image is identified as a concept, not a measured plan.

## 9. Decisions still open

1. Is a reference photo essential to the first demo, or is a prepared example kitchen acceptable?
2. Should projects be portable as a single file, or is a project folder acceptable for the MVP?
3. Which hackathon model accounts and credits are already accessible?
4. How much development time and how many people are available?
5. Is there an existing interface design or mockup the workspace should follow?