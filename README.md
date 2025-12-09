# Org Chart Interface Extension

An interactive organizational chart visualization for Airtable Interfaces. This custom element renders employee hierarchies as a navigable tree structure with pan, zoom, and collapsible nodes.

## Features

- **Interactive Navigation** — Pan by dragging and zoom with scroll wheel or buttons
- **Collapsible Nodes** — Expand/collapse branches to focus on specific parts of the hierarchy
- **Record Details** — Click any card to open Airtable's native record detail view
- **Custom Card Properties** — Configure up to 3 additional fields to display on each card
- **Dark Mode Support** — Automatically adapts to your interface's color scheme
- **Responsive Layout** — Smart tree layout algorithm prevents node overlap

## Prerequisites

- An Airtable base with an employees/people table containing:
  - A **name** field (any text field type)
  - A **profile picture** field (attachment field)
  - A **manager** field (linked record field pointing to the same table)

## Configuration

After adding the extension to your Interface page, configure it via the properties panel:

### Required Fields

| Property | Description |
|----------|-------------|
| **Employees Table** | The table containing your employee records |
| **Name Field** | The field to use for employee names |
| **Profile Picture Field** | An attachment field containing profile photos |
| **Manager Field** | A linked record field pointing to each employee's manager |

### Optional Card Properties

You can display up to 3 additional fields on each card:

| Property | Description |
|----------|-------------|
| **Card Property (1)** | First additional field to display |
| **Card Property (2)** | Second additional field to display |
| **Card Property (3)** | Third additional field to display |

These are useful for showing job titles, departments, email addresses, or any other relevant information.

## Usage

### Navigation

- **Pan** — Click and drag anywhere on the canvas
- **Zoom** — Use the scroll wheel, or click the `+` / `-` buttons
- **Reset View** — Click "Reset View" to return to the initial centered position

### Interacting with Nodes

- **Expand Record** — Click on any card to open the full record detail view
- **Collapse/Expand Branch** — Click the "Hide Reports" / "Show X Reports" button on cards with direct reports
