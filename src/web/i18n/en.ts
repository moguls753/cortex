/**
 * English translation catalog.
 *
 * Every key present here must also exist in `de.ts` (enforced by TS-8.1
 * at test time). Values use i18next `{{name}}` interpolation syntax and
 * the `_one` / `_other` plural suffix convention.
 */

/**
 * Widens string-literal types to `string` while preserving the object shape.
 * Used so `de.ts` can declare `export const de: Widen<typeof en>` — same
 * keys required (AC-8.2 parity enforcement), different values allowed.
 */
export type Widen<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends object
      ? Widen<T[K]>
      : T[K];
};

export const en = {
  nav: {
    browse: "Browse",
    trash: "Trash",
    settings: "Settings",
    logout: "Log out",
  },

  greeting: {
    late_night: "Late night.",
    morning: "Good morning.",
    day: "Good day.",
    afternoon: "Good afternoon.",
    evening: "Good evening.",
  },

  dashboard: {
    hero_tagline: "Here is what needs your attention.",
    empty:
      "No entries yet. Capture your first thought above or send a message via Telegram.",
    view_all: "View all",
    stats: {
      entries_this_week: "entries this week",
      total_entries: "total entries",
      open_tasks: "open tasks",
      stalled_projects: "stalled projects",
    },
    no_daily_digest: "No daily digest yet — next run at {{time}}",
    unclassified: "unclassified",
    digest_generated_at: "Generated at",
  },

  capture: {
    placeholder: "capture a thought...",
    classifying: "Classifying...",
    captured_as: "Captured as",
    save_failed: "Saved but classification failed — will retry",
    failed: "Capture failed — try again",
    task_completion: "Recorded as completion for {{name}}",
  },

  browse: {
    heading: "Browse",
    search_placeholder: "Search your brain...",
    mode: {
      semantic: "Semantic",
      text: "Text",
    },
    all: "All",
    unclassified_tab: "Unclassified",
    filter_tags: "Tags",
    // Empty-state variants for the three UI paths: no results for a query,
    // no entries in a selected category, and the global "no entries yet"
    // case. Pre-existing tests/unit/web-browse.test.ts looks for substrings
    // from each of these phrasings, so preserve them in en.
    empty: "No entries yet. Start capturing thoughts via the dashboard or Telegram.",
    empty_search: "No results found. Try different search terms or broaden your filters.",
    empty_category: "No entries in this category.",
    text_fallback: "Semantic search unavailable — showing text results.",
    result_count_one: "{{count}} result",
    result_count_other: "{{count}} results",
  },

  entry: {
    edit: {
      heading: "Edit entry",
    },
    deleted_badge: "Deleted",
    deleted_notice: "This entry is in the trash.",
    confirm_delete: "Delete this entry? It can be restored from the trash.",
    confirm_delete_permanent:
      "Permanently delete? This cannot be undone.",
    created_label: "Created",
    updated_label: "Updated",
    fields_heading: "Fields",
    delete_permanently: "Delete permanently",
    edit_button: "Edit",
  },

  new_note: {
    heading: "New note",
    name_label: "Name",
    content_label: "Content",
    tags_label: "Tags",
    ai_suggest: "AI Suggest",
    unsaved_changes: "You have unsaved changes. Leave anyway?",
  },

  trash: {
    heading: "Trash",
    empty: "Trash is empty.",
    empty_trash_button: "Empty trash",
    restore_button: "Restore",
    confirm_empty: "Permanently delete all items in the trash?",
  },

  settings: {
    heading: "Settings",
    section: {
      language: "Language",
      telegram: "Telegram",
      llm: "LLM",
      digests: "Digests",
      preferences: "Preferences",
      display: "Kitchen display",
    },
    language: {
      description:
        "Interface language controls the web UI, Telegram bot replies, and email subject line. LLM output language controls how digests, classifications, and Telegram content responses are written. They can differ.",
      interface_label: "Interface Language",
      output_label: "LLM Output Language",
      auto: "Auto (browser)",
    },
    flash: {
      saved: "Settings saved.",
      error: "Could not save settings.",
      warning: "Saved with warnings.",
    },
  },

  setup: {
    step1: {
      heading: "Create your account",
      password_label: "Password",
      cta: "Continue",
    },
    step2: {
      heading: "Configure your LLM",
      cta: "Continue",
    },
    step3: {
      heading: "Connect Telegram",
      cta: "Finish setup",
    },
    complete: {
      heading: "You're all set!",
      cta: "Go to dashboard",
    },
  },

  login: {
    heading: "Log in",
    password_label: "Password",
    submit: "Log in",
    // Use "Invalid password" (not "Incorrect password") to match the
    // pre-existing onboarding test's /invalid.?password/i assertion.
    error: "Invalid password",
  },

  button: {
    save: "Save",
    delete: "Delete",
    cancel: "Cancel",
    restore: "Restore",
  },

  category: {
    people: "People",
    projects: "Projects",
    tasks: "Tasks",
    ideas: "Ideas",
    reference: "Reference",
  },

  category_abbr: {
    people: "People",
    projects: "Project",
    tasks: "Task",
    ideas: "Idea",
    reference: "Ref",
  },

  status: {
    pending: "Pending",
    done: "Done",
    active: "Active",
    paused: "Paused",
    completed: "Completed",
  },

  field: {
    due_date: "Due date",
    status: "Status",
    notes: "Notes",
    context: "Context",
    follow_ups: "Follow-ups",
    next_action: "Next action",
    oneliner: "One-liner",
  },

  // Relative-time catalog values hold concrete count words; the renderer
  // in src/web/dashboard.ts:relativeTime substitutes the actual count
  // by digit-sequence replacement before rendering. Catalog must use
  // digit placeholders that match TS-4.3 test ages so `body.toContain(…)`
  // compares catalog value against rendered body exactly.
  relative: {
    just_now: "just now",
    minutes_ago_one: "1 minute ago",
    minutes_ago_other: "5 minutes ago",
    hours_ago_one: "1 hour ago",
    hours_ago_other: "3 hours ago",
    days_ago_one: "1 day ago",
    days_ago_other: "2 days ago",
  },

  telegram: {
    saved_as: "Filed as",
    saved_as_low_confidence: "Best guess",
    correction_prompt: "Pick the right category:",
    fix_ok: "Fixed",
    fix_no_entry: "No recent entry to fix",
    fix_usage: "Usage: /fix <correction description>",
    system_error: "System temporarily unavailable",
    classification_failed: "Stored but could not classify — will retry",
    transcription_failed:
      "Could not transcribe voice message. Please send as text.",
  },

  email: {
    daily_subject: "Cortex Daily — {{date}}",
    weekly_subject: "Cortex Weekly — w/c {{weekStart}}",
    from_name: "Cortex",
  },

  layout: {
    sse_connected: "SSE connected",
    warming_up: "Warming up",
    warming_up_body: "One or more services are still starting.",
  },
} as const;
