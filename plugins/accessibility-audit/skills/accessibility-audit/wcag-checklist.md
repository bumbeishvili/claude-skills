# WCAG 2.2 checklist

Generated from `lib/wcag.cjs` (`node lib/wcag.cjs --markdown > wcag-checklist.md`); edit that file, not this one. Which audit checks give evidence for each criterion is in the report's conformance table, computed from `lib/checks.cjs` and the engines' rule tags.

| SC | Criterion | Level | What a person confirms | How sites usually fail it |
|---|---|---|---|---|
| 1.1.1 | Non-text Content | A | Read every image alt and chart alternative in the report inventory: informative images say what they show, decorative ones are hidden, charts carry their numbers in text. | Charts with no text alternative; icons without names; alt that repeats the file name. |
| 1.2.1 | Audio-only and Video-only (Prerecorded) | A | For each audio-only or silent video, find a transcript or text description that gives the same information. | Podcast embeds and silent product loops with no text version. |
| 1.2.2 | Captions (Prerecorded) | A | Play each video with sound and confirm synchronised captions exist, are accurate and identify speakers. | Auto-captions never reviewed; third-party embeds with captions turned off. |
| 1.2.3 | Audio Description or Media Alternative (Prerecorded) | A | Watch each video with the sound on and eyes closed: is anything visual and necessary left undescribed? | On-screen text and charts in videos never spoken. |
| 1.2.4 | Captions (Live) | AA | Live streams only: confirm live captions are provided. | Webinar embeds without live captioning. |
| 1.2.5 | Audio Description (Prerecorded) | AA | For each video, confirm an audio-described version or that the narration already describes all key visuals. | Explainer videos that show data without saying it. |
| 1.3.1 | Info and Relationships | A | Check that what looks like a heading, list, table, group or label is marked up as one (heading and landmark outline in the report). | Styled divs as headings; tables without headers; radio groups without a legend. |
| 1.3.2 | Meaningful Sequence | A | Compare the virtual screen reader transcript with the page layout: content is read in an order that makes sense. | CSS order, absolute positioning or grid placement that puts the reading order out of step. |
| 1.3.3 | Sensory Characteristics | A | Read instructions: none rely only on shape, colour, size, position or sound ("the green button", "on the right"). | Chart legends and help text that name colours only. |
| 1.3.4 | Orientation | AA | Rotate a phone, or use the landscape screenshot: content and functions work in both orientations. | A "rotate your device" overlay; layouts that hide content in landscape. |
| 1.3.5 | Identify Input Purpose | AA | Fields that collect the user's own details (name, email, phone, address) carry the right autocomplete value. | Newsletter email fields without autocomplete="email". |
| 1.4.1 | Use of Color | A | Check charts, links and states: colour is never the only cue (a pattern, label, underline or icon also carries it). | Chart series told apart by colour alone; links in text with no underline. |
| 1.4.2 | Audio Control | A | Load each page with sound on: nothing plays sound for more than 3 seconds without a pause or volume control. | Autoplaying hero videos with sound. |
| 1.4.3 | Contrast (Minimum) | AA | Look at text over images, gradients and video, and text in charts, where tools cannot always compute contrast. | Light grey helper text; white labels on mid-tone chart colours; text over photos. |
| 1.4.4 | Resize Text | AA | Zoom the browser to 200%: all text grows, nothing is cut off or overlaps, every function still works. | Fixed-height boxes that clip text; text in images. |
| 1.4.5 | Images of Text | AA | Find text shown as images (banners, chart titles, screenshots of tables) and confirm it is real text or essential. | Infographics exported as one image. |
| 1.4.10 | Reflow | AA | At 320 CSS px wide (400% zoom), read and use every part of the page without scrolling sideways, except data tables, maps and diagrams. | Wide tables and charts that push the whole page sideways; sticky bars that fill the window. |
| 1.4.11 | Non-text Contrast | AA | Check icons, form field borders, focus rings, chart marks and the parts of controls needed to see their state: 3:1 against neighbours. | Pale input borders; thin light focus rings; adjacent chart segments of similar colour. |
| 1.4.12 | Text Spacing | AA | Look at the text-spacing screenshots: no text is cut off or overlaps after the spacing override. | Buttons and cards with fixed heights. |
| 1.4.13 | Content on Hover or Focus | AA | For each tooltip, popover and chart hover card: Escape dismisses it, the pointer can move onto it, and it stays until dismissed. | Chart tooltips that vanish when the pointer moves toward them. |
| 2.1.1 | Keyboard | A | Complete every task with the keyboard alone, including charts, carousels, menus, drag-and-drop alternatives and custom widgets. | Click-only divs; chart data reachable only by hover; custom selects without key handling. |
| 2.1.2 | No Keyboard Trap | A | Tab into and out of every widget, embed and dialog; any non-standard way out is explained. | Embedded players and editors that keep Tab. |
| 2.1.4 | Character Key Shortcuts | A | If single-key shortcuts exist, they can be turned off or remapped, or act only while their control has focus. | Search on "/" or "s" that fires while typing in another field. |
| 2.2.1 | Timing Adjustable | A | Find time limits (session timeouts, auto-dismissing messages, timed quizzes): the user can turn off, adjust or extend them. | Toasts that vanish in 3 seconds; silent session expiry. |
| 2.2.2 | Pause, Stop, Hide | A | Anything that moves, blinks, scrolls or auto-updates for more than 5 seconds can be paused, stopped or hidden. | Auto-advancing carousels; looping background video; live tickers. |
| 2.3.1 | Three Flashes or Below Threshold | A | Watch animations and videos: nothing flashes more than three times in any second. | Strobing transitions in video. |
| 2.4.1 | Bypass Blocks | A | A skip link is the first Tab stop and moves focus past the header; landmarks and headings let a screen reader jump. | Skip links that scroll but leave focus in the header. |
| 2.4.2 | Page Titled | A | Each page title, including after in-app navigation, says what the page is. | Single-page apps that never update the title. |
| 2.4.3 | Focus Order | A | Watch the headed walk and the focus order map: focus moves in an order that matches the meaning, and returns sensibly after dialogs and route changes. | Focus left on a removed element; dialogs that do not return focus; route changes that leave focus in the header. |
| 2.4.4 | Link Purpose (In Context) | A | Each link says where it goes, by its text or with its sentence, list item, cell or heading. | Rows of "Learn more"; "click here". |
| 2.4.5 | Multiple Ways | AA | Every page is reachable more than one way: navigation, search, site map, related links. | Pages linked only from one card. |
| 2.4.6 | Headings and Labels | AA | Headings and labels describe their topic or purpose (read the heading outline on its own). | Generic headings such as "Overview" repeated in every section. |
| 2.4.7 | Focus Visible | AA | Watch the headed walk: every stop shows a clear focus indicator. | outline: none without a replacement; rings hidden by overflow: hidden. |
| 2.4.11 | Focus Not Obscured (Minimum) | AA | Watch the headed walk, also at 200% zoom: no focused control is entirely hidden by sticky headers, footers, cookie banners or chat widgets. | Sticky headers and cookie banners covering the focused link. |
| 2.5.1 | Pointer Gestures | A | Any multi-point or path-based gesture (pinch, swipe, draw) has a single-pointer alternative such as buttons. | Carousels and maps that need a swipe or pinch. |
| 2.5.2 | Pointer Cancellation | A | Press a control, move the pointer off it, release: nothing should happen (or the action is undoable). | Custom buttons acting on mousedown. |
| 2.5.3 | Label in Name | A | For controls with visible text, the accessible name starts with or contains that text, so speech users can say it. | aria-label that replaces the visible label with different words. |
| 2.5.4 | Motion Actuation | A | Nothing is operated by shaking or tilting the device, or there is a control alternative and motion can be turned off. | Shake-to-undo without a button. |
| 2.5.7 | Dragging Movements | AA | Every drag (sliders, sortable lists, map panning, range brushes) has a single-pointer alternative such as clicks or buttons. | Range sliders and sortable lists that only drag. |
| 2.5.8 | Target Size (Minimum) | AA | Small targets the script flagged: confirm none is essential at that size and none crowds another. | Tiny close buttons, chip remove icons, pagination dots. |
| 3.1.1 | Language of Page | A | The html lang matches the page language. | Missing lang on app shells. |
| 3.1.2 | Language of Parts | AA | Passages in another language carry their own lang attribute. | Quotes and names in another language read with the wrong pronunciation. |
| 3.2.1 | On Focus | A | Tab through every control: focus alone never opens a window, submits, or moves the page. | Menus that navigate on focus. |
| 3.2.2 | On Input | A | Changing a field, checkbox or select does not move to a new page or window without warning. | Select menus that navigate on change. |
| 3.2.3 | Consistent Navigation | AA | Repeated navigation appears in the same relative order on every page. | Section pages that reorder or drop header links. |
| 3.2.4 | Consistent Identification | AA | The same function has the same name everywhere (icons, buttons, links to the same place). | One page says "Search", another "Find". |
| 3.2.6 | Consistent Help | A | Help (contact details, help page, chat) is in the same relative place on every page that has it. | Contact link only on some pages. |
| 3.3.1 | Error Identification | A | Submit each form with mistakes: the field in error is identified and the error described in text, and announced. | Red borders only; errors not tied to their field. |
| 3.3.2 | Labels or Instructions | A | Every field has a visible label or instruction, and required fields and formats are stated. | Placeholder-only fields. |
| 3.3.3 | Error Suggestion | AA | When an error has a known fix, the message suggests it ("Enter a date like 31/12/2026"). | "Invalid input" with no hint. |
| 3.3.4 | Error Prevention (Legal, Financial, Data) | AA | Submissions with legal, financial or data-changing effects can be reviewed, corrected or reversed. | One-click deletes without confirmation. |
| 3.3.7 | Redundant Entry | A | Multi-step forms do not ask again for information already given in the same process. | Re-entering an address on a later step. |
| 3.3.8 | Accessible Authentication (Minimum) | AA | Sign-in needs no memory or puzzle test without an alternative: paste and password managers work, CAPTCHAs have an accessible option. | Password fields that block paste; image CAPTCHAs. |
| 4.1.2 | Name, Role, Value | A | Custom widgets announce their name, role and state, and state changes are announced (headed walk transcript). | Toggle buttons without aria-pressed or aria-expanded; div buttons. |
| 4.1.3 | Status Messages | AA | Messages that appear without a focus move (results counts, saved, errors, loading) are announced: see the flow announcements. | Filter result counts that update silently. |
| 2.3.3 | Animation from Interactions | AAA | With reduced motion requested, motion triggered by interaction can be turned off. | Parallax and scroll animations that ignore prefers-reduced-motion. |
| 3.2.5 | Change on Request | AAA | New windows open only on request, and links say when they open one. | target="_blank" without warning. |
