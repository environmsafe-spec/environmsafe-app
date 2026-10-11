// Default template layouts (the same as the database seed). Used when a
// template has not been loaded on the device yet.
import type { TemplateSection } from '../lib/types';

const s = (key: string, title: string, text_block?: string): TemplateSection => ({ key, title, enabled: true, ...(text_block ? { text_block } : {}) });

export const DEFAULT_TEMPLATES: Record<string, { name: string; cover: boolean; sections: TemplateSection[] }> = {
  inspection: {
    name: 'Inspection report', cover: true,
    sections: [s('document_control', 'Document control'), s('contents', 'Contents'), s('scope', 'Scope', 'scope_general'), s('equipment', 'Equipment details'),
      s('method', 'Method'), s('results', 'Results'), s('readings', 'Thickness readings'), s('previous_findings', 'Status of previous findings'),
      s('findings', 'Findings and priorities'), s('recommendations', 'Recommendations'), s('conclusion', 'Conclusion'), s('limitations', 'Limitations', 'lim_general'),
      s('certificates', 'Certificates'), s('signatures', 'Sign-off'), s('photos', 'Annex – Photographs')],
  },
  final: {
    name: 'Final report', cover: true,
    sections: [s('document_control', 'Document control'), s('contents', 'Contents'), s('summary', 'Executive summary'), s('scope', 'Scope', 'scope_general'),
      s('equipment_register', 'Equipment inspected'), s('inspections', 'Inspection results'), s('findings', 'Findings and priorities'), s('dpr_summary', 'Daily progress summary'),
      s('holds', 'Holds and observations'), s('certificates', 'Certificates issued'), s('limitations', 'Limitations', 'lim_general'), s('signatures', 'Sign-off'), s('photos', 'Annex – Photographs')],
  },
  dpr: {
    name: 'Daily progress report', cover: false,
    sections: [s('dpr_header', 'Report details'), s('manpower', 'Manpower and hours'), s('hse', 'HSE'), s('activities', 'Activities completed'), s('progress', 'Progress'),
      s('holds', 'Holds and observations'), s('planned', 'Planned activities – next day'), s('issues', 'Issues and constraints'), s('photos', 'Photographs')],
  },
  followup: {
    name: 'Previous findings follow-up', cover: true,
    sections: [s('document_control', 'Document control'), s('followup_table', 'Status of findings'), s('limitations', 'Limitations', 'lim_general')],
  },
  due_register: { name: 'Due and overdue register', cover: false, sections: [s('due_table', 'Inspection schedule')] },
  custom: {
    name: 'Custom report', cover: true,
    sections: [s('document_control', 'Document control'), s('scope', 'Scope', 'scope_general'), s('equipment_register', 'Equipment'), s('inspections', 'Inspection results'),
      s('findings', 'Findings'), s('due_table', 'Inspection schedule'), s('limitations', 'Limitations', 'lim_general'), s('photos', 'Annex – Photographs')],
  },
};

/** Every section a custom report can include. */
export const ALL_REGISTER_SECTIONS: TemplateSection[] = [
  s('document_control', 'Document control'), s('contents', 'Contents'), s('summary', 'Executive summary'), s('scope', 'Scope', 'scope_general'),
  s('equipment_register', 'Equipment'), s('inspections', 'Inspection results'), s('findings', 'Findings'), s('followup_table', 'Status of findings'),
  s('dpr_summary', 'Daily progress summary'), s('holds', 'Holds and observations'), s('certificates', 'Certificates'), s('due_table', 'Inspection schedule'),
  s('limitations', 'Limitations', 'lim_general'), s('signatures', 'Sign-off'), s('photos', 'Annex – Photographs'),
];
