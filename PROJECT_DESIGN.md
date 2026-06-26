# Project: 哲人の刻 — Internal Dashboard

## Stack
- Framework: Next.js (App Router)
- UI Library: shadcn/ui — ALWAYS use shadcn components first
- Styling: Tailwind CSS v3 — utility classes only, no custom CSS files
- Icons: lucide-react — outline style only, size 16px default
- Language: TypeScript

## shadcn/ui — Mandatory Usage Rules

When implementing ANY UI element, check shadcn FIRST:
✓ USE shadcn  Button, Badge, Card, Table, Tabs, Input, Textarea,
              Separator, Accordion, Dialog, Sheet, Tooltip,
              Select, Switch, Progress, Skeleton, Avatar

✗ NEVER write custom CSS classes for these — use shadcn + Tailwind utilities

Import pattern:
  import { Button } from "@/components/ui/button"
  import { Badge } from "@/components/ui/badge"
  import { Card, CardContent, CardHeader } from "@/components/ui/card"
  import { Table, TableBody, TableCell, TableHead,
           TableHeader, TableRow } from "@/components/ui/table"
  import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

If a shadcn component doesn't exist yet, run:
  npx shadcn@latest add [component-name]
before writing any code.

## Design System — iOS Minimal

### Tailwind config overrides (already set in tailwind.config.ts)
Font: font-sans = system-ui, -apple-system, "SF Pro Text", sans-serif
Border radius: rounded-xl = 12px, rounded-lg = 10px, rounded-md = 8px

### Color tokens — use these Tailwind classes
Page bg:       bg-[#F2F2F7]
Surface/card:  bg-white
Input fill:    bg-[#E5E5EA]
Primary text:  text-[#1C1C1E]
Secondary:     text-[#6E6E73]
Tertiary:      text-[#AEAEB2]
Separator:     border-black/[.08]
Accent blue:   text-[#007AFF]  bg-[#007AFF]
Success:       text-[#34C759]  bg-[#D1F2D1]
Warning:       text-[#FF9F0A]  bg-[#FFF3D1]
Danger:        text-[#FF3B30]  bg-[#FFE5E5]

### Typography scale — Tailwind classes
Page title h1:   text-[28px] font-semibold tracking-tight
Section h2:      text-[17px] font-semibold
Body:            text-[15px] font-normal leading-relaxed
Caption:         text-[13px] text-[#6E6E73]
Micro label:     text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]

font-weight ceiling: font-semibold (600) max — NEVER use font-bold (700)

### Spacing — Tailwind classes
Page padding:    px-6 py-8  (mobile: px-4)
Section gap:     space-y-8
Card padding:    p-5
List item:       px-4 py-3

## Status Badge Map

Use shadcn Badge component with these exact variant overrides:

ready_to_publish → className="bg-[#D1F2D1] text-[#1A7A1A] border-0"  text="Ready"
published        → className="bg-[#D1E8FF] text-[#0A52A8] border-0"  text="Published"
needs_attention  → className="bg-[#FFE8D1] text-[#A84F0A] border-0"  text="Needs review"
needs_retry      → className="bg-[#FFE8D1] text-[#A84F0A] border-0"  text="Retry"
scoring          → className="bg-[#E5E5EA] text-[#3C3C43] border-0"
topic / outline  → className="bg-[#F2F2F7] text-[#6E6E73] border-0"
scripted/seo_done→ className="bg-[#E5E5EA] text-[#3C3C43] border-0"

### Score color
≥ 85 → text-[#34C759]
70–84 → text-[#FF9F0A]
< 70  → text-[#FF3B30]
Format: "90 / 100"

## Component Conventions

### Page layout wrapper
<main className="min-h-screen bg-[#F2F2F7] px-6 py-8">
  <div className="max-w-5xl mx-auto space-y-8">
    {children}
  </div>
</main>

### Section with micro label
<section>
  <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2] mb-2">
    SECTION LABEL
  </p>
  <Card className="border-black/[.08] shadow-none rounded-xl">
    <CardContent className="p-0 divide-y divide-black/[.06]">
      {rows}
    </CardContent>
  </Card>
</section>

### Stat card (dashboard)
<Card className="border-black/[.08] shadow-none rounded-xl p-5">
  <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
    READY TO PUBLISH
  </p>
  <p className="text-[34px] font-semibold text-[#1C1C1E] leading-none mt-1">4</p>
</Card>

### Lucide icon usage
import { ChevronRight, Settings, Clock, CheckCircle } from "lucide-react"
<ChevronRight className="w-4 h-4 text-[#AEAEB2]" />
Never use emoji as icons in UI components.

## Hard Rules — Never Break

- NO gradients (no bg-gradient-*, no linear-gradient in style)
- NO box shadows (no shadow-*, except shadow-none)
- NO custom CSS files (no .module.css, no <style> tags)
- NO font-bold / font-extrabold (ceiling is font-semibold)
- NO colored section backgrounds (only bg-white or bg-[#F2F2F7])
- NO emoji in UI (use lucide-react icons)
- All interactive elements: min-height 44px (min-h-[44px])
- Transitions: transition-colors duration-150 or transition-opacity only

## Dark Mode
Use Tailwind dark: prefix on every color:
bg-white → bg-white dark:bg-[#1C1C1E]
bg-[#F2F2F7] → bg-[#F2F2F7] dark:bg-[#000000]
text-[#1C1C1E] → text-[#1C1C1E] dark:text-white
text-[#6E6E73] → text-[#6E6E73] dark:text-[#AEAEB2]
border-black/[.08] → border-black/[.08] dark:border-white/[.10]