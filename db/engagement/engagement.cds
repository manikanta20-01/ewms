namespace ewms.db.engagement;

using { managed } from '@sap/cds/common';

using ewms.db.common as enums from '../common/enums';
using { ewms.db.employee.Employee } from '../employee/employee';

// ============================================================
// SPRINT 18 - EMPLOYEE ENGAGEMENT (SURVEYS, SUGGESTIONS, KUDOS)
// ------------------------------------------------------------
// Backend-only engagement module on top of the EXISTING Employee
// model. It deliberately contains three small, separable
// capabilities (scope decision documented in SPRINT-18.md):
//
//   1. EngagementSurveys  - HR-created questionnaires with a
//      controlled lifecycle and (optionally) CONFIDENTIAL results.
//   2. Suggestions        - employee feedback with a review
//      lifecycle. NOT anonymous (see the privacy note below).
//   3. Recognitions       - employee-to-employee appreciation.
//
// B4 wording implemented here: TRUE anonymity is NOT
// offered for suggestions because the submitter association and
// the shared audit trail both record who created a row. Hiding a
// field in a UI would be security theater, so the sprint takes
// the honest route: identity is stored and access is tightly
// restricted instead.
// ============================================================

// ------------------------------------------------------------
// 1. SURVEYS
// ------------------------------------------------------------
entity EngagementSurvey : managed {
    key ID : UUID;

    title       : String(150) not null;
    description : String(1000);

    // Lifecycle vocabulary; transitions only via Publish/Close/
    // Archive actions (see handlers). Draft rows are editable,
    // everything later is immutable except the status itself.
    status : enums.SurveyStatus default 'Draft';

    // Response window. openingDate must be set; closingDate is
    // optional (null = open-ended until closed manually).
    openingDate : Date not null;
    closingDate : Date;

    // Confidentiality vs anonymity: `confidential` means the
    // INDIVIDUAL answers are never visible (not even to HR) -
    // only aggregate counts/distributions. Responses still carry
    // the employee for dedupe, so a survey is NEVER anonymous
    // (a documented, deliberate decision - see SPRINT-18.md).
    confidential : Boolean default false;

    // Duplicate-submission policy: default = exactly one response
    // per employee; when explicitly configured, employees may
    // submit again only AFTER withdrawing their previous response.
    allowMultipleResponses : Boolean default false;

    // Optional narrowing: null = all employees; otherwise only
    // employees of this employment type may submit (same simple
    // audience rule as Sprint 17 DocumentRequirements).
    audienceEmploymentType : enums.EmploymentType;

    createdByAdmin : Association to Employee;

    questions : Composition of many SurveyQuestion
        on questions.survey = $self;
}

// One question in a survey; editable only while Draft.
entity SurveyQuestion : managed {
    key ID : UUID;

    survey : Association to EngagementSurvey not null;

    questionText : String(500) not null;
    sortOrder    : Integer default 1;
    isRequired   : Boolean default true;

    responseType : enums.SurveyResponseType not null;

    // Only used when responseType = Choice: the selectable
    // options, stored newline-separated ("Pizza\nSushi\nSalad").
    choiceOptions : String(1000);
}

// One submission of one employee for one survey.
entity SurveyResponse : managed {
    key ID : UUID;

    survey    : Association to EngagementSurvey not null;
    employee  : Association to Employee not null;

    submittedOn : Timestamp;
    status      : enums.SurveyResponseStatus default 'Submitted';
    withdrawnOn : Timestamp;

    answers : Composition of many SurveyAnswer
        on answers.response = $self;
}

// One answer to one question inside one response. VALUES are
// validated server-side against the question definition; there
// is deliberately NO direct READ on SurveyAnswers in the service
// (confidentiality is enforced structurally, not per request).
// @cds.autoexposed:false keeps the OData adapter from exposing
// the composition as its own entity set/collection.
@cds.autoexposed: false
entity SurveyAnswer : managed {
    key ID : UUID;

    response : Association to SurveyResponse not null;
    question : Association to SurveyQuestion not null;

    // Exactly ONE of these is filled, according to the question
    // responseType (validated in handlers/surveys.js).
    textValue   : String(500);
    numberValue : Integer;
    boolValue   : Boolean;
    choiceValue : String(100);
}

// ------------------------------------------------------------
// 2. SUGGESTIONS (EMPLOYEE FEEDBACK)
// ------------------------------------------------------------
entity Suggestion : managed {
    key ID : UUID;

    // Server-set from $user.employeeId on CREATE (never accepted
    // from the payload).
    submittedBy : Association to Employee not null;

    // NOT anonymous by design: see the privacy note in
    // SPRINT-18.md. Access is restricted; identity is kept so a
    // review conversation is possible.
    category : enums.SuggestionCategory not null;
    subject  : String(150) not null;
    message  : String(2000) not null;

    status : enums.SuggestionStatus default 'Submitted';

    // Set by the reviewer action; only HR can move the lifecycle.
    reviewedBy     : Association to Employee;
    reviewedOn     : Timestamp;
    reviewOutcome  : String(2000);

    // Employees may add context while the review has not started.
    additionalNotes : String(2000);
}

// ------------------------------------------------------------
// 3. RECOGNITIONS (APPRECIATION / KUDOS)
// ------------------------------------------------------------
entity Recognition : managed {
    key ID : UUID;

    // Server-set from $user.employeeId: a recognition is ALWAYS
    // attributed to the real logged-in user (validated in
    // handlers/recognitions.js).
    fromEmployee : Association to Employee not null;

    // The appreciated colleague; self-recognition is refused.
    toEmployee : Association to Employee not null;

    category : enums.RecognitionCategory not null;
    message  : String(1000) not null;

    recognitionDate : Date not null;

    // Admin-only moderation:Hidden rows disappear from lists.
    status : enums.Status default 'Active';

    moderatedBy   : Association to Employee;
    moderatedOn   : Timestamp;
    moderationNote : String(500);
}
