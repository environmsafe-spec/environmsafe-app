/* =============================================================================
   EnvironmSafe form destinations
   -----------------------------------------------------------------------------
   All four forms are connected. Each formId is the code between /d/e/ and
   /viewform in the form's URL; each entry.NNNNNN is the hidden id of one
   question. They were generated on 8 September 2026 and read back from the
   forms themselves, so the order is guaranteed to match.

   IF YOU EDIT A FORM: adding a question at the END is safe. Reordering or
   deleting questions is not — the ids stay attached to the questions, but it
   is easy to end up mapping the wrong one. If in doubt, open the form, use
   the three-dot menu -> "Get pre-filled link", fill in every question with a
   recognisable dummy answer, and send that link over; every id is inside it.

   NEVER change a question to multiple choice or dropdown, and never mark one
   as required. The site sends free text and omits empty optional fields, so
   either change would make Google reject the whole submission silently.
   ========================================================================== */
window.ES_FORMS = {

  contact: {
    formId: '1FAIpQLSceDB3e9FCEngcnYtsqKBv3WbmgPgX0Uwq9NJKa05QhsVDIeA',
    entries: {
      name:    'entry.213487054',    // Full name
      company: 'entry.348130702',    // Company / organization
      email:   'entry.576540403',    // Email
      phone:   'entry.853244207',    // Phone
      service: 'entry.139073434',    // Service needed
      message: 'entry.650295052',    // Project details
      lang:    'entry.1336825936'    // Page language (en/ar)
    }
  },

  feedback: {
    formId: '1FAIpQLSf97C3KwDK4CmyY3aMiP1ZES4EriXpnV4c6-u_I-cC7bVRzFQ',
    entries: {
      rating:  'entry.1998197064',   // Not good / Okay / Great
      reasons: 'entry.2110105590',   // Comma-separated tags
      comment: 'entry.879003312',    // Free text
      jobRef:  'entry.1189090018',   // Job reference from the link
      service: 'entry.956508439',    // Service from the link
      name:    'entry.1123913102',   // Optional
      contact: 'entry.2046371694',   // Optional phone or email
      lang:    'entry.1700431308'
    }
  },

  complaint: {
    formId: '1FAIpQLSfvd6fJvwNGF3MDURU72Z3j7nqca_pKGqpT8xtmhEJZ8kW8_g',
    entries: {
      refCode:  'entry.913422480',   // Reference code we generate
      role:     'entry.1742591149',  // Customer / Employee / Other
      category: 'entry.68069949',    // Safety concern / Service quality / ...
      details:  'entry.1997428486',  // The complaint itself
      place:    'entry.1675456693',  // Where and when
      name:     'entry.742802609',   // Blank when anonymous
      contact:  'entry.657838150',   // Blank when anonymous
      lang:     'entry.44267025'
    }
  },

  grievance: {
    formId: '1FAIpQLSf8KpKyEMnlFUzOE6HKOYyuffsEVQrBxvXxkEEmoKenb-jWfg',
    entries: {
      refCode:  'entry.1427655386',  // Reference code we generate
      role:     'entry.655590451',   // Employee / Contractor or daily worker / Former employee
      dept:     'entry.1670777936',  // Site, department or team
      category: 'entry.1288043278',  // Unfair treatment / Pay, hours... / Harassment...
      details:  'entry.635300324',   // What happened
      outcome:  'entry.902901549',   // What would put it right
      raised:   'entry.1562032438',  // Not yet / With my line manager / With HR or management
      place:    'entry.1871752410',  // Where and when
      name:     'entry.282541649',   // Blank when anonymous
      contact:  'entry.1706187876',  // Blank when anonymous
      lang:     'entry.1283998582'
    }
  }

};
