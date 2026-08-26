window.DASHBOARD_DATA = {
  generated: "2026-08-11T11:59:08Z",
  task: { name: "Catalog Applications UI", type: "product-design", status: "completed", created: "2026-08-11T11:19:35Z", updated: "2026-08-11T11:59:08Z" },
  phases: [
    { id: 0, title: "Initialize & Gather Context", status: "completed", icon_hint: "analysis", summary: "Enhancement | UI-focused | complex. External BE context: research + development task dirs in repo-alpha worktree." },
    { id: 1, title: "Context Synthesis", status: "completed", icon_hint: "analysis", summary: "BE contract digest + FE integration digest synthesized; R1-R8 risks.", artifacts: [{ path: "analysis/design-context.md", label: "Design Context" }] },
    { id: 2, title: "Problem Exploration", status: "completed", icon_hint: "analysis", summary: "Problem statement, C1-C17, S1-S12.", artifacts: [{ path: "analysis/problem-statement.md", label: "Problem Statement" }] },
    { id: 3, title: "Personas", status: "completed", icon_hint: "analysis", summary: "Ewa / Tomasz / Agata + journeys; line manager explicitly excluded.", artifacts: [{ path: "analysis/personas.md", label: "Personas" }] },
    { id: 4, title: "Idea Generation", status: "completed", icon_hint: "plan", summary: "12 areas x 44 alternatives (solution-brainstormer).", artifacts: [{ path: "analysis/alternatives.md", label: "Alternatives", html: "analysis/alternatives.html" }] },
    { id: 5, title: "Idea Convergence", status: "completed", icon_hint: "plan", summary: "One module, one detail route, three doors (D1-D12).", artifacts: [{ path: "analysis/design-decisions.md", label: "Design Decisions", html: "analysis/design-decisions.html" }] },
    { id: 6, title: "Feature Specification", status: "completed", icon_hint: "spec", summary: "8 implementation-ready sections.", artifacts: [{ path: "analysis/feature-spec.md", label: "Feature Spec", html: "analysis/feature-spec.html" }] },
    { id: 7, title: "Visual Prototyping", status: "completed", icon_hint: "code", summary: "13 HTML mockups (delta: Settings replaced by Processes CRUD).", artifacts: [
      { path: "analysis/mockups/catalog-employee-tab-widget-shell.html", label: "Employee tab", html: "analysis/mockups/catalog-employee-tab-widget-shell.html" },
      { path: "analysis/mockups/my-enrollments-catalog-cta-widget-integration.html", label: "Enrollment CTA", html: "analysis/mockups/my-enrollments-catalog-cta-widget-integration.html" },
      { path: "analysis/mockups/my-actions-catalog-decision-item-handler-inbox.html", label: "Handler inbox item", html: "analysis/mockups/my-actions-catalog-decision-item-handler-inbox.html" },
      { path: "analysis/mockups/new-request-eligible-trainings-picker.html", label: "New-request picker", html: "analysis/mockups/new-request-eligible-trainings-picker.html" },
      { path: "analysis/mockups/request-detail-preparing-your-form.html", label: "Detail: preparing", html: "analysis/mockups/request-detail-preparing-your-form.html" },
      { path: "analysis/mockups/request-detail-filling-the-form-embedded-survey.html", label: "Detail: filling", html: "analysis/mockups/request-detail-filling-the-form-embedded-survey.html" },
      { path: "analysis/mockups/request-detail-handler-view-awaiting-decision.html", label: "Detail: handler", html: "analysis/mockups/request-detail-handler-view-awaiting-decision.html" },
      { path: "analysis/mockups/reject-with-reason-dialog.html", label: "Reject dialog", html: "analysis/mockups/reject-with-reason-dialog.html" },
      { path: "analysis/mockups/request-detail-approved-requester-view.html", label: "Detail: approved", html: "analysis/mockups/request-detail-approved-requester-view.html" },
      { path: "analysis/mockups/admin-handoff-tab-multi-select-unrecorded-banner.html", label: "Admin: Handoff", html: "analysis/mockups/admin-handoff-tab-multi-select-unrecorded-banner.html" },
      { path: "analysis/mockups/admin-processes-tab-list.html", label: "Admin: Processes", html: "analysis/mockups/admin-processes-tab-list.html" },
      { path: "analysis/mockups/admin-process-editor-catalog.html", label: "Admin: Process editor", html: "analysis/mockups/admin-process-editor-catalog.html" },
      { path: "analysis/mockups/request-detail-notification-diagnostics-manage.html", label: "Notification log", html: "analysis/mockups/request-detail-notification-diagnostics-manage.html" }
    ] },
    { id: 8, title: "Review & Handoff", status: "completed", icon_hint: "done", summary: "Layered product brief assembled and approved (autonomous mode per user instruction).", artifacts: [{ path: "outputs/product-brief.md", label: "Product Brief", html: "outputs/product-brief.html" }] }
  ],
  decisions: ["D1 hybrid placement", "D3 detail-page waiting room", "D5 shared capability-driven detail route", "D9 export/attest banner flow", "D12 minimal BE contract ask"],
  risks: ["BE Groups 12/14/16 + auth-repo deploy block FE start", "BE delta absorbed 2026-08-11: Processes CRUD, processId threading, error-map update", "SurveyResponseStatus.WITHDRAWN sweep", "Polish native copy pass", "host nav link deferred"]
};
