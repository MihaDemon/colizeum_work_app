# API endpoints

Install backend dependencies with `pip install -r requirements.txt`. All new
endpoints require a token (`Authorization: Token <token>`) or an authenticated
Django session. The existing Telegram authentication route is unchanged.

## Devices and stations

Each collection supports GET/POST. Each `/<id>/` detail supports GET/PUT/PATCH/DELETE.
Relationships on stations accept device IDs or `null`.
Only admin users (`is_staff=True`, Django's existing admin flag) may create,
update or delete devices and stations. Other authenticated users retain read,
identifier lookup and QR-code access; write attempts return 403.

| Collection | QR lookup identifier |
| --- | --- |
| `/api/mice/` | `serial_number` |
| `/api/keyboards/` | `serial_number` |
| `/api/headsets/` | `serial_number` |
| `/api/monitors/` | `serial_number` |
| `/api/pcs/` | `serial_number` |
| `/api/playstations/` | `serial_number` |
| `/api/stations/` | `club_number` |

Every device/station response includes `id`, `detail_url` and `qr_code_url`.
GET `qr_code_url` (e.g. `/api/mice/3/qr-code/`) returns a printable PNG with a
four-module white border. Its encoded payload is `detail_url`, built from the
request's API host and the device's identifier. Nothing is written to media storage.

Example payload: `https://club.example/api/mice/lookup/?serial_number=SN-123`.
Stations use `/api/stations/lookup/?club_number=12`. GET this URL returns the same
serialized device/station details as the numeric detail route. PlayStations always
use their serial number. Query-string encoding preserves slashes, punctuation,
spaces and Unicode identifiers. Missing/invalid identifiers return 400; unknown
identifiers return 404. Scan results retain the same authentication requirements
as the rest of the API. Generate labels using the API host users will access;
regenerate a label after changing its device identifier.

## Reports and expenses

`/api/reports/`, `/api/expenses/`, `/api/report-photos/` and
`/api/expense-photos/` support list/create and numeric detail CRUD routes.

Reports expose `shift`, `date`, `admin`, `cards`, `spb`, `cash`, `remaining_cash`,
`encashment`, `info` and nested `photos`. Expenses expose `date`, `admin`, `amount`,
`info` and nested `photos`. `id`, `date`, `admin` and nested `photos` are read-only.
Creation records the authenticated user as the administrator; edits preserve it.

To create a report, POST multipart form data with fields such as `shift=day`,
`cards=100.00`, and one or more files under the repeated `uploaded_photos` key.
Reports require at least one valid image; expenses allow zero. PUT/PATCH can append
images through `uploaded_photos` and otherwise retain existing photos.

Photo endpoints accept `report` or `expense` (parent ID) and `image` (multipart file).
Use photo detail endpoints to replace or delete individual images. The API rejects
deleting the last report photo or moving a report photo to another report. Deleting
a parent report/expense also deletes its photo database records through the existing
model relationship.

Run the API tests with `python manage.py test api` from the backend directory.
