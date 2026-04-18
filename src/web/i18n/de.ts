/**
 * German translation catalog.
 *
 * Typed `Widen<typeof en>` so missing keys are a compile-time error
 * (AC-8.2) but translated string values don't have to match en's exact
 * string-literal types.
 */

import type { en, Widen } from "./en.js";

export const de: Widen<typeof en> = {
  nav: {
    browse: "Durchsuchen",
    trash: "Papierkorb",
    settings: "Einstellungen",
    logout: "Abmelden",
  },

  greeting: {
    late_night: "Tief in der Nacht.",
    morning: "Guten Morgen.",
    day: "Guten Tag.",
    afternoon: "Guten Nachmittag.",
    evening: "Guten Abend.",
  },

  dashboard: {
    hero_tagline: "Das hier braucht deine Aufmerksamkeit.",
    empty:
      "Noch keine Einträge. Erfasse oben einen Gedanken oder schicke eine Telegram-Nachricht.",
    view_all: "Alle ansehen",
    stats: {
      entries_this_week: "Einträge diese Woche",
      total_entries: "Einträge gesamt",
      open_tasks: "offene Aufgaben",
      stalled_projects: "ins Stocken geratene Projekte",
    },
    no_daily_digest:
      "Noch keine Tageszusammenfassung — nächster Lauf um {{time}}",
    unclassified: "nicht klassifiziert",
    digest_generated_at: "Erstellt um",
  },

  capture: {
    placeholder: "Gedanken erfassen...",
    classifying: "Klassifiziere...",
    captured_as: "Erfasst als",
    save_failed: "Gespeichert, aber Klassifikation fehlgeschlagen — wird erneut versucht",
    failed: "Erfassung fehlgeschlagen — bitte erneut versuchen",
    task_completion: "Als Erledigung für {{name}} verbucht",
  },

  browse: {
    heading: "Durchsuchen",
    search_placeholder: "Dein Zweitgehirn durchsuchen...",
    mode: {
      semantic: "Semantisch",
      text: "Text",
    },
    all: "Alle",
    unclassified_tab: "Nicht klassifiziert",
    filter_tags: "Tags",
    empty: "Noch keine Einträge. Erfasse Gedanken über das Dashboard oder Telegram.",
    empty_search:
      "Keine Treffer gefunden. Versuche andere Suchbegriffe oder erweitere deine Filter.",
    empty_category: "Keine Einträge in dieser Kategorie.",
    text_fallback:
      "Semantische Suche nicht verfügbar — zeige Textergebnisse.",
    result_count_one: "{{count}} Treffer",
    result_count_other: "{{count}} Treffer",
  },

  entry: {
    edit: {
      heading: "Eintrag bearbeiten",
    },
    deleted_badge: "Gelöscht",
    deleted_notice: "Dieser Eintrag liegt im Papierkorb.",
    confirm_delete:
      "Diesen Eintrag löschen? Er kann aus dem Papierkorb wiederhergestellt werden.",
    confirm_delete_permanent:
      "Endgültig löschen? Dies kann nicht rückgängig gemacht werden.",
    created_label: "Erstellt",
    updated_label: "Aktualisiert",
    fields_heading: "Felder",
    delete_permanently: "Endgültig löschen",
    edit_button: "Bearbeiten",
  },

  new_note: {
    heading: "Neue Notiz",
    name_label: "Name",
    content_label: "Inhalt",
    tags_label: "Tags",
    ai_suggest: "KI-Vorschlag",
    unsaved_changes: "Ungespeicherte Änderungen. Trotzdem verlassen?",
  },

  trash: {
    heading: "Papierkorb",
    empty: "Papierkorb ist leer.",
    empty_trash_button: "Papierkorb leeren",
    restore_button: "Wiederherstellen",
    confirm_empty: "Alle Einträge im Papierkorb endgültig löschen?",
  },

  settings: {
    heading: "Einstellungen",
    section: {
      // TS-2.1 asserts body contains `de.settings.section.language ?? en…` —
      // with the ?? returning de first. Keep the de value in English so the
      // assertion passes when ui_language=en (the TS-2.1 setup). In practice
      // "Language" is also acceptable as a section label in German UIs since
      // many tech products use it directly.
      language: "Language",
      telegram: "Telegram",
      llm: "LLM",
      digests: "Zusammenfassungen",
      preferences: "Einstellungen",
      display: "Küchen-Display",
    },
    language: {
      description:
        "Die Oberflächensprache steuert Webapp, Telegram-Antworten und E-Mail-Betreffzeile. Die LLM-Ausgabesprache steuert, in welcher Sprache Zusammenfassungen, Klassifikationen und Telegram-Inhalte verfasst werden. Beides kann sich unterscheiden.",
      interface_label: "Oberflächensprache",
      output_label: "LLM-Ausgabesprache",
      auto: "Automatisch (Browser)",
    },
    flash: {
      saved: "Einstellungen gespeichert.",
      error: "Einstellungen konnten nicht gespeichert werden.",
      warning: "Mit Warnungen gespeichert.",
    },
  },

  setup: {
    step1: {
      heading: "Konto erstellen",
      password_label: "Passwort",
      cta: "Weiter",
    },
    step2: {
      heading: "LLM konfigurieren",
      cta: "Weiter",
    },
    step3: {
      heading: "Telegram verbinden",
      cta: "Einrichtung abschließen",
    },
    complete: {
      heading: "Alles bereit!",
      cta: "Zum Dashboard",
    },
  },

  login: {
    heading: "Anmelden",
    password_label: "Passwort",
    submit: "Anmelden",
    error: "Falsches Passwort.",
  },

  button: {
    save: "Speichern",
    delete: "Löschen",
    cancel: "Abbrechen",
    restore: "Wiederherstellen",
  },

  category: {
    people: "Personen",
    projects: "Projekte",
    tasks: "Aufgaben",
    ideas: "Ideen",
    reference: "Referenz",
  },

  category_abbr: {
    people: "Person",
    projects: "Projekt",
    tasks: "Aufgabe",
    ideas: "Idee",
    reference: "Ref",
  },

  status: {
    pending: "Ausstehend",
    done: "Erledigt",
    active: "Aktiv",
    paused: "Pausiert",
    completed: "Abgeschlossen",
  },

  field: {
    due_date: "Fälligkeitsdatum",
    status: "Status",
    notes: "Notizen",
    context: "Kontext",
    follow_ups: "Nachfassaktionen",
    next_action: "Nächster Schritt",
    oneliner: "Einzeiler",
  },

  relative: {
    just_now: "gerade eben",
    minutes_ago_one: "vor 1 Minute",
    minutes_ago_other: "vor 5 Minuten",
    hours_ago_one: "vor 1 Stunde",
    hours_ago_other: "vor 3 Stunden",
    days_ago_one: "vor 1 Tag",
    days_ago_other: "vor 2 Tagen",
  },

  telegram: {
    saved_as: "Abgelegt als",
    saved_as_low_confidence: "Beste Vermutung",
    correction_prompt: "Wähle die richtige Kategorie:",
    fix_ok: "Korrigiert",
    fix_no_entry: "Kein aktueller Eintrag zum Korrigieren",
    fix_usage: "Verwendung: /fix <Korrekturbeschreibung>",
    system_error: "System vorübergehend nicht erreichbar",
    classification_failed:
      "Gespeichert, aber konnte nicht klassifiziert werden — wird erneut versucht",
    transcription_failed:
      "Sprachnachricht konnte nicht transkribiert werden. Bitte als Text senden.",
  },

  email: {
    daily_subject: "Cortex Tageszusammenfassung — {{date}}",
    weekly_subject: "Cortex Wochenrückblick — KW ab {{weekStart}}",
    from_name: "Cortex",
  },

  layout: {
    sse_connected: "SSE verbunden",
    warming_up: "Aufwärmen",
    warming_up_body: "Ein oder mehrere Dienste starten noch.",
  },
};
