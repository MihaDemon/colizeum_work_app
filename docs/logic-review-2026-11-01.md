# Backend and frontend logic review — 1 November 2026

Scope: authentication and registration, employee administration, shift opening and closing, report/photo validation, expenses and cash accounting, task assignment/submission/moderation, automatic tasks, schedules and delivery, notifications, equipment, frontend transport, background refresh, and form state. This is a functional review; it is not a claim that every possible defect has been excluded.

Application source was not changed. All reproductions used local browser mocks or disposable test databases/containers. Production records were not modified.

## Confirmed application bugs

### 1. [P1] A close form can apply an old shift's revenue to a newer shift

Locations: `frontend/src/LiveWorkspace.tsx:142`, `frontend/src/pages/Workspace.tsx:462`, `frontend/src/lib/workspace.ts:134`.

The close action does not contain the shift ID for which the form was opened. The form's React key includes only the form type and employee ID, so its amounts and photos survive a change of active shift. At submission, `perform()` chooses the latest shift from `snapshotRef.current`.

Reproduction: open the close form for shift A, enter revenue, close A and open B for the same employee in another session, then let the first session refresh. Submitting the original form sends those amounts to B's close endpoint. A browser reproduction preserved cash `100` and card revenue `200` while changing the active shift from ID `1` to `2`; the resulting POST targeted `/api/shifts/2/close/`.

Impact: a newer shift can be closed using the previous shift's report values. Backend ownership checks cannot detect the original intent because the frontend supplies the newer ID.

Recommended correction: capture the originating shift ID when opening the form, include it in the action, and reject/invalidate the form if that shift changes. Build the request path from the captured ID.

### 2. [P1] A new identical expense can be suppressed after a lost response

Locations: `frontend/src/LiveWorkspace.tsx:199`, `backend/workflows/commands.py:41`.

The retry key is stored globally in `LiveWorkspace` and selected using only `JSON.stringify(action)`. It survives a failed request and is not reset when the user discards the form. A later, separate expense with identical values therefore reuses the old key.

Reproduction: persist a 100-ruble expense, lose its HTTP response, refresh to observe that expense, cancel the original form, then open a fresh expense form and submit a second 100-ruble expense with the same description. A browser reproduction sent the same idempotency key for both distinct forms. The backend receipt lookup replays the first successful response instead of recording the second expense.

Impact: the UI reports success for the second expense while cash and expense history contain only the first.

Recommended correction: scope the request identity to a specific form/operation instance. Preserve its key for retries of that operation and generate a new identity when a new operation starts, even when its values match an older operation.

### 3. [P2] Reassigning an open shift leaves required tasks inaccessible

Locations: `backend/workflows/admin.py:24`, `backend/workflows/services.py:69`, `backend/workflows/services.py:169`.

Changing `Shift.admin` does not transfer the required tasks. Employee deletion sets their assignee to null. Closing still checks all tasks linked by `required_for_shift`, while submitting a task requires that its assignee match the submitting employee.

Reproduction: create an automatic required task, open a shift, delete its administrator, and reassign the shift through Django admin. The replacement administrator's task list is empty; submitting the required task returns 404; closing the shift returns 409 naming that inaccessible task. This was reproduced through the actual Django admin and API.

Impact: the replacement cannot close the shift without another manual correction of its tasks.

Recommended correction: make open-shift reassignment a coordinated operation under the shared workflow lock. Transfer the outstanding required tasks and handle their assignment notifications, while preserving previous submission history.

### 4. [P2] Editing an employee's name can silently undo a role change

Locations: `backend/users/admin.py:69`, `backend/workflows/personnel.py:149`.

Django's User administration synchronizes `is_active` with the employee card but does not synchronize `is_staff` with `AdminUser.role`. The Personnel API later derives `User.is_staff` from that stale card role on every edit, including a name-only PATCH.

Reproduction: promote a registered administrator to manager through the Django User form, then change only their first name through Personnel. The user first has `is_staff=True` while their card still says `admin`; the name edit resets `is_staff=False`. Reproduced through both real endpoints.

Impact: employees can unexpectedly gain or lose manager capabilities when unrelated personal information is saved. The reverse direction can restore an older manager role after a demotion.

Recommended correction: keep role data consistent across both administrative entry points and ensure unrelated partial edits do not silently overwrite a separately changed role.

### 5. [P2] Attachments crash two Django administration pages

Locations: `backend/api/fields.py:11`, `backend/workflows/models.py:88`, `backend/workflows/models.py:287`.

`EvidenceFile.url` indexes a model-name mapping that omits `automatictasktemplate` and `scheduledelivery`. Both models use `EvidenceImageField`. When an existing image is rendered by Django's file widget, its URL property raises `KeyError`.

Reproduction: create an automatic template with a reference photo and open its Django admin change page; repeat with a schedule delivery containing an image. Both GET requests raise the corresponding `KeyError`.

Impact: those records cannot be opened or edited normally in Django admin once they have an image. Task reference images reached through the Mini App's existing explicit URL route are unaffected by this specific error.

Recommended correction: provide supported authenticated image URL handling for both model types, including a delivery-image route or suitable admin attachment handling. Adding a mapping alone is insufficient when the destination route does not exist.

### 6. [P2] Archived schedule images are fetched without authentication

Locations: `frontend/src/components/PrivateImage.tsx:12`, `frontend/src/components/SchedulePage.tsx:667`, `backend/workflows/schedule_views.py:96`.

`PrivateImage` fetches authenticated blobs only for URLs beginning with `/api/files/`. Schedule summaries use `/api/schedules/<id>/image/`, so they become ordinary `<img>` requests without the Mini App's token header. The schedule-image endpoint requires authentication.

Reproduction: open a schedule containing a summary image and click “Итоговое изображение.” Browser inspection confirmed that the image request had no Authorization header. With the endpoint returning the expected 401, the image remained broken (`naturalWidth === 0`).

Impact: token-authenticated Mini App users cannot view the summary image. A separate valid Django session cookie can mask this issue during manual testing.

Recommended correction: include protected schedule images in the authenticated blob-loading path.

## Verification and test coverage

| Check | Result |
| --- | --- |
| Frontend unit tests | 38 passed across 7 files |
| Production frontend build | Passed in the isolated Docker build |
| Backend suite on PostgreSQL | 188 passed, including concurrency tests |
| Existing desktop/mobile browser tests | 128 passed |
| Focused backend review cases | 5 passed: reproduced the two admin-image crashes, reassignment failure, and role regression; verified original-photo acceptance and safe retry |
| Focused browser reproductions | Confirmed stale-shift submission, unauthenticated schedule image, and reused expense key after discarding a form |
| Original real-stack integration test | Failed because the scenario omits a required night-shift date |
| Temporary corrected integration scenario | Passed the full real nginx/PostgreSQL/Django/Mini App workflow after supplying that date |

The integration-test mismatch is at `frontend/tests/e2e/stack.spec.ts:203`: its fresh stack contains no recent closed day shift, but the scenario selects a night shift and submits without filling “Дата по графику.” The application correctly keeps the form open and asks for the date. The temporary test copy supplied the date; production source and the repository test were left unchanged.

Review evidence remains available in this session:

- `/tmp/colizeum_review_backend.py`
- `/tmp/colizeum_review_browser.mjs`
- `/tmp/colizeum-review-backend-reproductions.log`
- `/tmp/colizeum-review-browser-tests.log`
- `/tmp/colizeum-review-integration.log` — original scenario failure
- `/tmp/colizeum-review-integration-adapted.log` — corrected scenario success

## Original photo-upload incident

Both supplied JPEG files passed the actual close-shift serializer and service in an isolated API test. Repeating the same multipart request with the same idempotency key created neither additional report photos nor additional cash. This supports the earlier finding that these copies are valid inputs. It does not reproduce or explain the interrupted phone-to-host-nginx uploads, and none of the findings above is claimed as that incident's confirmed root cause.
