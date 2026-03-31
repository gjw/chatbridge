# Design Decisions & Rationale

Decisions made during architecture, with context from group critique. For final
submission justification.

---

## App Hosting: External Iframes vs Signed/Managed Apps

**Decision:** Apps are hosted externally by their developers, loaded via iframe.
Platform controls access through curated registry (teacher/admin approval), iframe
sandbox, CSP, and report/suspend.

**Alternative considered:** Apps audited, signed, and served from ChatBridge
infrastructure. Guarantees content integrity — app can't change what it serves
after approval.

**Why we chose external iframes:**

- **Target audience is small schools.** A principal who's also the IT department
  can stand up ChatBridge and let teachers approve apps from a catalog. No signing
  infrastructure, no CDN, no audit pipeline to maintain.
- **Developer friction.** Requiring apps to be submitted, audited, and hosted by
  the platform kills third-party adoption. External hosting means any web developer
  can build and host a ChatBridge app.
- **Cost.** Hosting all app content = storage + bandwidth + review labor. Small
  schools and open-source deployments can't absorb that.
- **Realistic for a one-week sprint.** Code signing and managed hosting is
  infrastructure we can't build and shouldn't pretend to have.
- **Mirrors real-world models.** Chrome Web Store, Google Workspace Marketplace,
  Apple App Store for Education all use curated registries, not hosted-only.

**The known risk:** An approved app's developer can change what the iframe serves
after approval, or lie to the LLM about what's being displayed. Mitigated by:

- Iframe CSP restricting loadable resources
- Content filter on all tool results before they reach the LLM
- Report + instant platform-wide suspend
- Teacher/admin curation as the primary gate

**Path to the locked-down version:** Nothing in the architecture prevents adding a
`managed` trust tier later where apps are audited, signed, and served from the
platform's own CDN. ChatBridge starts as a small open-source thing any school can
stand up. Someone can build a mega-install SaaS version on top that sells access
and verifies all plugins per school district. The trust tier system already supports
this — just add a tier above `internal`.

**Source:** Group critique session, 2026-03-31. Cohort was split on this. Both
positions are defensible — ours optimizes for accessibility and adoption over
maximum control.
