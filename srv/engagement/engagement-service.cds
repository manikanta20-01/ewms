using { ewms.db.engagement as db } from '../../db/schema';
using { ewms.db.employee as emp } from '../../db/schema';

// ============================================================
// SPRINT 18 - EMPLOYEE ENGAGEMENT (SERVICE)
// ------------------------------------------------------------
// Three capabilities, one service - all built on the existing
// Employee model, none duplicating other modules:
//
//   1. EngagementSurveys (+ questions/responses)
//        * lifecycle Draft -> Published -> Closed -> Archived
//          through the bound Publish / Close / Archive actions
//          only; direct PATCH cannot move the status.
//        * submission through the bound Submit action only: the
//          handler validates the survey window, the audience,
//          required questions, answer TYPES and duplicate rule.
//        * aggregate results through the bound SurveyResults
//          action; individual answers are NOT exposed as an
//          entity (confidential surveys can never leak them).
//   2. Suggestions - employee feedback with an HR review
//      lifecycle (Resolve action; employees may enrich their own
//      suggestion only while it is still in 'Submitted').
//   3. Recognitions - employee-to-employee appreciation;
//      sender is always the logged-in user, moderation is HR.
// ============================================================

service EngagementService @(requires: 'authenticated-user') {

    // Survey authoring + lifecycle (readable metadata for all).
    entity EngagementSurveys as projection on db.EngagementSurvey actions {
        // Lifecycle actions (HRAdmin + SystemAdmin only).
        action Publish() returns String;
        action Close()   returns String;
        action Archive() returns String;

        // Employee submission: validates everything in one shot and
        // creates response + answers inside the action transaction.
        action Submit(answers : array of {
                          question_ID : UUID;
                          textValue   : String(500);
                          numberValue : Integer;
                          boolValue   : Boolean;
                          choiceValue : String(100);
                      }) returns String;

        // Aggregate results: per question counts + distributions.
        // For confidential surveys ONLY aggregates are returned; for
        // open surveys the caller must still hold the HR grant on
        // this action.
        action SurveyResults()
            returns array of {
                question_ID   : UUID;
                questionText  : String(500);
                responseType  : String(20);
                responseCount : Integer;
                distribution  : String(1000); // compact JSON map value->count
            };
    };

    entity SurveyQuestions as projection on db.SurveyQuestion;

    // Responses are readable by the respondent and by HR admins;
    // answers are intentionally NOT exposed as an entity.
    entity SurveyResponses as projection on db.SurveyResponse actions {

        // The respondent may withdraw their own submission. This is
        // the configured "safe correction" route: a withdrawn
        // response can be re-submitted (fresh answers), which is how
        // "edit after submit" is implemented WITHOUT opening
        // submitted answers to direct edits.
        action Withdraw() returns String;
    };

    // Employee suggestions / feedback (NOT anonymous - see db model).
    entity Suggestions as projection on db.Suggestion actions {
        action Resolve(newStatus : String(20),
                       outcome : String(2000)) returns String;
    };

    // Recognition ("kudos") feed, all authenticated colleague read.
    entity Recognitions as projection on db.Recognition;
}
