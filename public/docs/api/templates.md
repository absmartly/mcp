# Experiment Markdown Templates

These templates can be used with the `createExperimentFromTemplate` command.
Fill in the values in the YAML frontmatter and markdown body, then pass the
content as the `templateContent` parameter.

---

## Basic A/B Test

```markdown
---
name: checkout_flow_optimization
display_name: "Checkout Flow Optimization"
type: test
state: created
percentage_of_traffic: 100
percentages: 50/50
unit_type: user_id
application: www
primary_metric: conversion_rate
secondary_metrics:
  - revenue_per_user
  - page_load_time
guardrail_metrics:
  - error_rate
  - bounce_rate
owners:
  - Jonas Alves <jonas@example.com>
teams:
  - Growth
tags:
  - checkout
  - conversion
---

## Variants

### variant_0

name: control
config: {"checkout_steps": 3, "show_progress_bar": true}

---

### variant_1

name: two_step_checkout
config: {"checkout_steps": 2, "show_progress_bar": true}

---

## Description

**Hypothesis:**
We believe that reducing checkout steps from 3 to 2 will increase conversion
rate by at least 5%, without negatively impacting error rate or bounce rate.

**Expected Impact:**
- Increase checkout conversion by 5-10%
- Reduce cart abandonment by 8%

**Success Criteria:**
- Primary metric shows statistically significant improvement
- No negative impact on guardrail metrics
```

---

## Feature Flag

```markdown
---
name: new_search_engine
display_name: "New Search Engine"
type: feature
state: created
percentage_of_traffic: 100
percentages: 50/50
unit_type: user_id
application: www
primary_metric: search_success_rate
secondary_metrics:
  - search_latency_p95
  - clicks_per_search
guardrail_metrics:
  - error_rate
owners:
  - Jonas Alves <jonas@example.com>
teams:
  - Search
tags:
  - search
  - infrastructure
---

## Variants

### variant_0

name: off
config: {"search_engine": "legacy"}

---

### variant_1

name: on
config: {"search_engine": "elasticsearch_v8"}

---

## Description

**Purpose:**
Feature flag to control rollout of the new Elasticsearch 8 search backend.
Start with 50/50 split, then ramp to full-on if metrics are stable.
```

---

## Group Sequential Test (GST)

Group Sequential Testing allows early stopping decisions — either for
efficacy (the treatment is clearly winning) or futility (the treatment
is unlikely to ever win). Use this for experiments where you want to
peek at results at scheduled intervals without inflating false positive rates.

```markdown
---
name: pricing_page_redesign
display_name: "Pricing Page Redesign"
type: test
state: created
percentage_of_traffic: 100
percentages: 50/50
unit_type: user_id
application: www
primary_metric: plan_upgrade_rate

secondary_metrics:
  - revenue_per_visitor
  - pricing_page_time_spent
  - plan_comparison_clicks

guardrail_metrics:
  - bounce_rate
  - support_ticket_rate

exploratory_metrics:
  - annual_plan_ratio
  - enterprise_inquiry_rate

owners:
  - Jonas Alves <jonas@example.com>
teams:
  - Growth
  - Monetization
tags:
  - pricing
  - revenue
  - gst

# ── Group Sequential Testing Configuration ──
analysis_type: group_sequential
required_alpha: 0.05
required_power: 0.8
baseline_participants: 5000

# Futility stopping: "binding" means if futility is declared, the test MUST stop.
# Use "non_binding" if you want the option to continue despite futility.
group_sequential_futility_type: binding

# Number of interim analyses (including the final one)
group_sequential_analysis_count: 4

# Minimum time between analyses (prevents too-frequent peeking)
group_sequential_min_analysis_interval: 3d

# Wait at least this long before the first analysis
group_sequential_first_analysis_interval: 7d

# Maximum experiment duration — auto-stops after this
group_sequential_max_duration_interval: 8w
---

## Audience

```json
{
  "filter": [
    {
      "gte": [
        { "var": "age" },
        { "value": 18 }
      ]
    }
  ]
}
```

## Variants

### variant_0

name: control
config: {"pricing_layout": "table", "highlight_plan": "pro", "show_annual_toggle": true}

---

### variant_1

name: card_layout
config: {"pricing_layout": "cards", "highlight_plan": "pro", "show_annual_toggle": true, "show_savings_badge": true}

---

## Description

**Hypothesis:**
We believe that switching the pricing page from a comparison table to a card
layout with savings badges will increase plan upgrade rate by at least 8%.

**Expected Impact:**
- Increase plan upgrades by 8-15%
- Improve revenue per visitor by 5%
- No increase in support tickets (people confused by pricing)

**Success Criteria:**
- Primary metric (plan_upgrade_rate) shows significant improvement at any
  scheduled interim analysis
- Guardrail metrics remain flat or improve
- If futility is declared at an interim analysis, stop early to save traffic

**GST Decision Points:**
- Analysis 1 (day 7): Early check — stop only if overwhelming signal
- Analysis 2 (day 10+): Main interim — stop for efficacy or futility
- Analysis 3 (day 13+): Second interim — tighter boundaries
- Analysis 4 (day 16+ or 8 weeks max): Final analysis — standard decision
```

---

## A/B Test with Screenshots

Variant screenshots help reviewers understand what each variant looks like.
Reference screenshots by file path or URL.

```markdown
---
name: homepage_hero_banner
display_name: "Homepage Hero Banner Test"
type: test
state: created
percentage_of_traffic: 100
percentages: 50/50
unit_type: user_id
application: www
primary_metric: hero_cta_click_rate
secondary_metrics:
  - scroll_depth
  - time_on_page
guardrail_metrics:
  - bounce_rate
owners:
  - Jonas Alves <jonas@example.com>
teams:
  - Design
  - Growth
tags:
  - homepage
  - design
---

## Variants

### variant_0

name: control
config: {"hero_style": "static_image", "cta_text": "Get Started"}
![Control - Static hero banner](screenshots/hero_control.png)

---

### variant_1

name: video_hero
config: {"hero_style": "autoplay_video", "cta_text": "Watch Demo"}
![Treatment - Video hero banner](screenshots/hero_treatment.png)

---

## Description

**Hypothesis:**
Replacing the static hero image with an autoplay video demo will
increase CTA click rate by 12%.
```

---

## A/B Test with Custom Fields

Custom fields are organization-specific metadata attached to experiments.
Reference them by name — the system resolves them to IDs automatically.

```markdown
---
name: mobile_nav_redesign
display_name: "Mobile Navigation Redesign"
type: test
state: created
percentage_of_traffic: 50
percentages: 50/50
unit_type: user_id
application: mobile-app
primary_metric: task_completion_rate
secondary_metrics:
  - navigation_depth
  - session_duration
guardrail_metrics:
  - crash_rate
  - error_rate
owners:
  - Jonas Alves <jonas@example.com>
teams:
  - Mobile
  - UX
tags:
  - mobile
  - navigation
  - ux

# Custom fields (names match your organization's configured fields)
custom_fields:
  JIRA Ticket: MOB-4521
  Design Spec: https://figma.com/file/abc123
  Risk Level: medium
  Review Status: pending
  Product Area: navigation
---

## Variants

### variant_0

name: control
config: {"nav_type": "hamburger_menu"}

---

### variant_1

name: bottom_tab_bar
config: {"nav_type": "bottom_tabs", "tabs": ["home", "search", "cart", "profile"]}

---

## Description

**Hypothesis:**
Switching from hamburger menu to bottom tab bar navigation will improve
task completion rate by 15% on mobile.

**Custom field notes:**
- JIRA Ticket links to the implementation epic
- Design Spec has the full Figma mockups
- Risk Level is medium because it changes core navigation
```

---

## Multi-Variant Test (A/B/C)

Tests with more than 2 variants. Adjust percentages to split traffic evenly
or weighted.

```markdown
---
name: cta_button_color
display_name: "CTA Button Color Test"
type: test
state: created
percentage_of_traffic: 100
percentages: 34/33/33
unit_type: user_id
application: www
primary_metric: cta_click_rate
secondary_metrics:
  - conversion_rate
guardrail_metrics:
  - bounce_rate
owners:
  - Jonas Alves <jonas@example.com>
teams:
  - Growth
tags:
  - cta
  - design
---

## Variants

### variant_0

name: control_blue
config: {"cta_color": "#2563EB", "cta_text": "Sign Up Free"}

---

### variant_1

name: green
config: {"cta_color": "#16A34A", "cta_text": "Sign Up Free"}

---

### variant_2

name: orange
config: {"cta_color": "#EA580C", "cta_text": "Sign Up Free"}

---

## Description

**Hypothesis:**
Green or orange CTA buttons will outperform the current blue button
by at least 5% in click-through rate.
```

---

## Template Field Reference

### Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Experiment name (snake_case) |
| `display_name` | string | No | Human-readable name |
| `type` | string | Yes | `test` or `feature` |
| `state` | string | No | Initial state: `created`, `ready` |
| `percentage_of_traffic` | number | No | 0-100, default 100 |
| `percentages` | string | Yes | Traffic split, e.g. `50/50` or `34/33/33` |
| `unit_type` | string | Yes | Unit type name (e.g. `user_id`) |
| `application` | string | Yes | Application name |
| `primary_metric` | string | No | Primary metric name |
| `secondary_metrics` | list | No | Secondary metric names |
| `guardrail_metrics` | list | No | Guardrail metric names |
| `exploratory_metrics` | list | No | Exploratory metric names |
| `owners` | list | No | `Name <email>` format |
| `teams` | list | No | Team names |
| `tags` | list | No | Tag names |
| `custom_fields` | map | No | Custom field name → value |
| `analysis_type` | string | No | `fixed_horizon` or `group_sequential` |
| `note` | string | No | Creation note |

### GST-Specific Fields

| Field | Type | Description |
|-------|------|-------------|
| `required_alpha` | number | Significance level (default 0.05) |
| `required_power` | number | Statistical power (default 0.8) |
| `baseline_participants` | number | Expected daily participants |
| `group_sequential_futility_type` | string | `binding` or `non_binding` |
| `group_sequential_analysis_count` | number | Number of interim analyses |
| `group_sequential_min_analysis_interval` | string | Min interval, e.g. `3d` |
| `group_sequential_first_analysis_interval` | string | First analysis wait, e.g. `7d` |
| `group_sequential_max_duration_interval` | string | Max duration, e.g. `8w` |

### Variant Sections

Each variant is a `### variant_N` section with:
- `name:` — variant name
- `config:` — JSON configuration string
- `![label](path)` — optional screenshot (file path or URL)
- `screenshot_id:` — optional existing screenshot upload ID

### Audience Section

Optional `## Audience` section with a JSON code block defining targeting rules.

### Description Section

Free-form markdown after the variants. Use for hypothesis, expected impact,
success criteria, and any notes for reviewers.
