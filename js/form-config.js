/* =============================================================================
   EnvironmSafe form destinations
   -----------------------------------------------------------------------------
   This is the ONLY file you edit to connect the forms to Google Forms.

   For each form, paste:
     formId  - the long code in your form's URL, between /d/e/ and /viewform
     entries - the entry.NNNNNN id for each question

   The easy way to get all of these at once, per form:
     1. Open the form in Google Forms
     2. Top-right menu (three dots) -> "Get pre-filled link"
     3. Type a recognisable dummy answer in every question, then "Get link" -> "Copy link"
     4. Send that link to whoever maintains this site; every entry id is inside it.

   Until a formId is filled in, that form shows a clear "not connected yet" notice
   instead of pretending to succeed.
   ========================================================================== */
window.ES_FORMS = {

  contact: {
    formId: '',                     // e.g. '1FAIpQLSd...'
    entries: {
      name:    '',                  // Full name
      company: '',                  // Company / organization
      email:   '',                  // Email
      phone:   '',                  // Phone
      service: '',                  // Service needed
      message: '',                  // Project details
      lang:    ''                   // Page language (en/ar)
    }
  },

  feedback: {
    formId: '',
    entries: {
      rating:  '',                  // Not good / Okay / Great
      reasons: '',                  // Comma-separated tags
      comment: '',                  // Free text
      jobRef:  '',                  // Job reference from the link
      service: '',                  // Service from the link
      name:    '',                  // Optional
      contact: '',                  // Optional phone or email
      lang:    ''
    }
  },

  complaint: {
    formId: '',
    entries: {
      refCode:  '',                 // Reference code we generate
      role:     '',                 // Customer / Employee / Other
      category: '',                 // Safety concern / Service quality / ...
      details:  '',                 // The complaint itself
      place:    '',                 // Where and when
      name:     '',                 // Blank when anonymous
      contact:  '',                 // Blank when anonymous
      lang:     ''
    }
  }

};
