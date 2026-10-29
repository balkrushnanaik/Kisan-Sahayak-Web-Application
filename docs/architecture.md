# Kisan Sahayak — Architecture Notes

## Domain boundaries

- **Identity:** `User` stores account identity and a role array; role-specific profile subdocuments hold farmer, labourer and machinery-provider fields.
- **Work marketplace:** `Job` is the farmer's public work listing; `JobApplication` captures a worker's application; `WorkRequest` represents a direct invitation or structured offer; `Assignment` is the immutable record of agreed work terms and later progress.
- **Machinery:** `MachineryListing` stores the provider's equipment and rental basis; `Booking` captures a rental request, negotiation and confirmed time interval.
- **Operations:** `Notification`, `Review`, `Report` and `AdminAuditLog` support activity, completed-interaction ratings, reporting and moderation audit trails.

## Trust boundaries

Client data is validated at the API boundary and again by Mongoose. Protected routes query the current session user and authorize ownership/participation on the server. User role activation adds permitted marketplace roles; clients cannot grant themselves `admin`. Public worker discovery includes only active, opt-in available workers and strips precise GeoJSON coordinates from display records.

## State changes

State transitions are declared in `server/src/services/workflow.ts`. Counter-offers append a proposal-history record; they do not establish an agreement by themselves. Work assignments are created only on acceptance of the original offer or acceptance of the latest proposal. Job worker counts use a conditional update to reserve a slot. Machinery confirmation uses a MongoDB transaction and checks for overlapping confirmed bookings before saving the final rate.

## Important production follow-ups

1. Integrate a production object storage provider; local uploads are disabled in production.
2. Add an email/SMS provider for password recovery and any OTP feature.
3. Complete Playwright flows against a disposable replica-set test database.
4. Add request-level tests for authorization and transactional race cases.
5. Add data retention, verified contact details, legal review, moderation runbooks and operational monitoring.
6. Revisit cookie `SameSite`/CORS settings for the final frontend/backend deployment domains and test them in real browsers.
