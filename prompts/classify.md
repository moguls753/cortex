Classify this: {context_entries}

Input: {input_text}

Return ONLY valid JSON. No explanation. No markdown.

The JSON must contain these fields:
- category: one of "people", "projects", "tasks", "ideas", "reference"
- name: a short descriptive name (max 6 words)
- confidence: a float between 0.0 and 1.0
- fields: an object with category-specific structured data
- tags: an array of lowercase strings
- create_calendar_event: boolean
- calendar_date: string in YYYY-MM-DD format, or null