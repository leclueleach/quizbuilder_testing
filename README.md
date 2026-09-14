# EDGE Quiz Builder

A standalone browser-based quiz authoring tool used to build, preview, validate, import and export CourseBook quizzes without requiring Articulate Storyline.

The builder uses a fixed **720 × 540 px learner canvas** so that authoring, validation, preview and export can be checked against the same learner-facing dimensions.

> **Important:** The platform export contract is a protected part of this project. Read the **Protected Export Contract** section before changing export code, filenames, folder structure, scoring, callbacks, randomisation or learner runtime behaviour.

---

## 1. What this project does

The Quiz Builder allows a user to:

- create a 5-question or 10-question quiz;
- enter a quiz title and output/folder name;
- author question text, four answer options and feedback;
- choose the correct answer;
- apply supported rich-text formatting;
- change line spacing;
- insert common symbols;
- edit the underlying HTML for an active text field;
- show or hide feedback while authoring;
- import Quiz Builder JSON;
- import supported standalone quiz HTML;
- import AI-converted quiz JSON;
- preview the learner experience;
- validate missing content and content that does not fit;
- randomise questions and answers independently for Preview and Export;
- export a platform-ready ZIP package.

The project is intentionally self-contained and browser-based.

---

## 2. Main project files

A typical project folder now looks like this:

```text
quiz-builder/
├── README.md
├── index.html
├── style.css
├── script.js
└── img/
```

### `index.html`

Defines the Quiz Builder interface.

It contains:

- the top action bar;
- quiz settings;
- question count;
- randomisation controls;
- correct-answer selector;
- AI/standalone import controls;
- AI conversion prompts;
- rich-text toolbar;
- question navigation;
- the authoring canvas container;
- the side HTML editor;
- references to `style.css`, `script.js`, Roboto and JSZip.

Most learner question fields are **not written directly into `index.html`**. They are generated dynamically by `script.js`.

### `style.css`

Controls the Builder interface and authoring canvas.

Important responsibilities include:

- application layout;
- settings panel;
- shared rich-text toolbar;
- question navigation;
- fixed 720 × 540 authoring canvas;
- title-screen layout;
- question, answer, image and feedback positioning;
- validation UI;
- overflow indicators;
- HTML editor panel;
- responsive Builder behaviour.

Do not casually change learner-container dimensions in CSS. The JavaScript validator uses matching learner dimensions.

### `script.js`

Contains the application behaviour.

Important responsibilities include:

- builder state;
- question generation;
- page navigation;
- rich-text editing;
- HTML editing;
- line spacing;
- field serialisation;
- learner-sized overflow measurement;
- validation;
- JSON import/export;
- standalone HTML import;
- AI-import normalisation;
- Preview generation;
- platform ZIP generation;
- randomisation;
- autosave/local draft restoration;
- Builder canvas scaling.

It also contains the platform-compatible learner export template.

---

## 3. Running the Builder locally

The Builder should be run through a local web server rather than by opening `index.html` directly with `file://`.

For example, use **Live Server** in VS Code.

This matters because export loads required image files with `fetch()`. Browsers commonly block or restrict those requests when the page is opened directly from the filesystem.

Basic workflow:

1. Open the project folder in VS Code.
2. Start Live Server from `index.html`.
3. Confirm the Builder loads.
4. Confirm the title screen and question assets display.
5. Create or import a quiz.
6. Preview and validate it.
7. Export the ZIP.
8. Test the exported `story.html` in the target environment before release.

The Builder also loads some external browser resources such as Roboto and JSZip, so network access may be required depending on the environment.

---

## 4. Authoring model

### Title screen

The Builder has a dedicated title page before the questions.

The learner title area is approximately:

- width: **483 px**
- height: **236 px**
- font size: **40 px**
- font weight: **500**
- centred

### Question screen

Each question contains:

- question number;
- question text;
- four answer options;
- one correct answer;
- question illustration;
- feedback view;
- feedback text.

### Learner geometry

The learner canvas is fixed at:

```text
720 × 540 px
```

Key content areas are approximately:

| Area | Outer / measured size | Default learner typography |
|---|---:|---|
| Quiz title | 483 × 236 | 40 px / weight 500 |
| Question | 426 × 140 | 14.67 px / weight 300 |
| Answer text | 343 × 60 usable text area | 13.33 px / weight 300 |
| Feedback | 188 × 250 | 14 px / weight 300 |
| Question image | 195 × 470 | contained image |

The answer card itself is **426 × 70 px**. The validator measures the usable answer-text area rather than the full card because the radio control and internal spacing consume part of the width.

These values are part of the fit-validation model. If they change in the learner design, update the matching JavaScript measurement profile as well.

---

## 5. Rich-text editing

The shared toolbar works on the currently active editable field.

Supported controls include:

- bold;
- italic;
- underline;
- superscript;
- subscript;
- bulleted lists;
- numbered lists;
- font size;
- line spacing;
- common symbols;
- raw HTML editing.

The Builder stores rich content as HTML.

### Line spacing

Supported line-spacing values are:

```text
1
1.15
1.5
2
```

Line spacing is stored with the field content so imported/exported quiz data can retain the authoring choice.

### HTML editor

The side HTML editor exposes the HTML for the currently active field.

Changes update the visual field and should still be passed through validation before export.

Use this feature carefully. Invalid or overly complex HTML can create content-fit or learner-rendering problems.

---

## 6. Question data model

Quiz Builder JSON uses this general structure:

```json
{
  "title": "Quiz title",
  "filename": "suggested_filename",
  "questions": [
    {
      "question": "Question HTML",
      "answers": [
        "Answer 1",
        "Answer 2",
        "Answer 3",
        "Answer 4"
      ],
      "correctIndex": 0,
      "feedback": "Feedback HTML"
    }
  ],
  "randomizePreview": true,
  "randomizeAnswersPreview": true,
  "randomizeExport": true,
  "randomizeAnswersExport": true
}
```

### Correct answer indexing

`correctIndex` is zero-based:

```text
0 = Answer 1
1 = Answer 2
2 = Answer 3
3 = Answer 4
```

Every question is expected to contain exactly four answers.

---

## 7. Randomisation

Question and answer randomisation are controlled independently.

There are four settings:

- `randomizePreview`
- `randomizeAnswersPreview`
- `randomizeExport`
- `randomizeAnswersExport`

This allows reviewers to turn randomisation off in Preview while keeping it enabled for the learner export.

Do not combine these settings into one flag unless the product requirement deliberately changes.

---

## 8. Validation and content fit

Validation checks both required content and learner fit.

The Builder measures content against hidden off-screen elements using the **learner dimensions**, rather than trusting the current size of the editable Builder field.

This is important because Builder scrollbars and browser scaling can otherwise change wrapping and produce a mismatch between:

- Builder;
- Preview;
- Export.

Validation can identify:

- missing quiz title;
- missing output/folder name;
- missing question text;
- missing answer text;
- content that overflows vertically;
- content that overflows horizontally;
- embedded visual content that exceeds the learner container.

Validation issues can jump the user back to the relevant question or field.

### Scrollbars

Scrollbars in the Builder are authoring feedback only.

A field that requires a scrollbar should normally be treated as a content-fit problem rather than assuming the learner export will scroll.

---

## 9. Images and embedded visuals

The project uses a **single `img/` folder** as the source for Builder, Preview and Export image assets.

This avoids maintaining duplicate copies of the same artwork in separate `assets/` and `img/` folders.

### Shared image assets

The Builder title screen, Builder question/feedback mock-ups, learner Preview and exported learner package all reference files from `img/`.

The following **18 PNG files are required for the learner export**:

```text
image1.png
image2.png
image3.png
image4.png
image5.png

correct1.png
correct2.png
correct3.png
correct4.png
correct5.png

incorrect1.png
incorrect2.png
incorrect3.png
incorrect4.png
incorrect5.png

CB_icon.png
CB_logo.png
quiz_icon.png
```

The Builder also uses `img/favicon.png` for the browser tab, making **19 files in the project `img/` folder** in total.

The export process checks that all required files were successfully loaded.

If any required PNG is missing, the ZIP export is cancelled.

Do not rename these files without deliberately updating and retesting the export runtime.

---

## 10. Mathematics and MathML

Structured maths should use semantic **MathML**.

The Builder supports both:

- inline maths inside normal sentence flow;
- display maths on its own line.

### Inline maths

Inline maths should remain inline and should not be wrapped in full-width block styling.

### Display maths

Display maths uses:

```html
display="block"
```

and may carry:

```html
data-qb-align="left"
data-qb-align="center"
data-qb-align="right"
```

The import normaliser removes common stretching styles that can make fractions or other MathML structures fill the entire text box.

Display equations are kept at natural/intrinsic width.

### Avoid

Do not add layout styling that stretches MathML unnecessarily, such as:

```text
width: 100%
large min-width values
flex-grow
full-width mfrac styling
```

Maths must still pass the same learner-fit validation as ordinary content.

---

## 11. AI conversion workflow

The Builder includes two copyable AI conversion prompts:

- **Fast conversion**
- **High fidelity**

The intended workflow is:

1. Copy the appropriate conversion prompt.
2. Open the approved AI tool.
3. Upload the source `.docx` or `.pptx`.
4. Convert the quiz to Quiz Builder JSON.
5. Download the JSON.
6. Use **Import File** in the Builder.
7. Review every question.
8. Run Preview.
9. Run Validate.
10. Export only after the quiz passes review.

The AI workflow is an import aid. The Builder remains the final authority for:

- layout;
- content fit;
- correct-answer selection;
- preview behaviour;
- export behaviour.

---

## 12. JSON and standalone import

The import control accepts supported JSON and standalone HTML quiz files.

### JSON import

The importer expects a question array using the Quiz Builder data model.

It restores:

- title;
- filename;
- questions;
- answers;
- correct answers;
- feedback;
- randomisation settings where supplied.

### Standalone HTML import

For compatible older standalone files, the importer extracts quiz data and available metadata from the HTML.

This allows older quiz packages to be reopened and updated in the current Builder.

Imported rich text is normalised before being placed into the Builder, particularly around display MathML sizing and alignment.

---

## 13. Preview

Preview is generated from the current Builder data.

It opens a learner-style quiz in a new browser window.

Preview uses:

- the current learner design;
- current question/answer content;
- feedback;
- Preview-specific randomisation settings;
- learner-sized assets and interactions.

If the browser blocks the new window, allow pop-ups for the Builder site.

### Preview is not the platform export runtime

Preview and Export are expected to remain visually and behaviourally aligned, but they are generated through separate code paths.

Preview is built by the Preview HTML builder.

Platform Export is built by the protected standalone/platform template.

When making learner-facing changes, test **both**.

---

## 14. Protected Export Contract

This is the most important maintenance section in this README.

### Export package structure

A normal export produces:

```text
<folder-name>.zip
└── <folder-name>/
    ├── story.html
    └── img/
        ├── image1.png
        ├── ...
        ├── correct1.png
        ├── ...
        ├── incorrect1.png
        ├── ...
        ├── CB_icon.png
        ├── CB_logo.png
        └── quiz_icon.png
```

The output/folder name comes from the Builder's filename field and is sanitised for use as a folder/file name.

### Protected behaviour

Do not change the following casually:

- ZIP structure;
- exported folder name behaviour;
- `story.html` filename;
- `img/` folder name;
- required exported image filenames;
- scoring logic;
- completion logic;
- platform callbacks;
- question randomisation semantics;
- answer randomisation semantics;
- quiz data format;
- metadata used for re-import;
- learner canvas size;
- learner navigation behaviour;
- review behaviour.

The export runtime is intentionally treated as a protected platform contract.

### Platform callbacks

The learner runtime uses platform-style lifecycle callbacks including:

```javascript
started()
completed(percentage)
```

The `completed()` callback receives the learner's final score as a **percentage from 0 to 100**.

#### Testing callbacks in the browser console

When testing an exported quiz locally, paste the following into the browser DevTools **Console** before starting the quiz:

```javascript
window.started = () => {
  console.log("STARTED");
};

window.completed = score => {
  console.log("COMPLETED");
  console.log("SCORE:", score + "%");
};
```

Expected console output will look similar to:

```text
STARTED
COMPLETED
SCORE: 80%
```

A compact one-line version is:

```javascript
window.started=()=>console.log("STARTED");window.completed=score=>console.log("COMPLETED | SCORE:",score+"%");
```

This confirms that:

- `started()` fires when the learner starts the quiz;
- `completed()` fires when the learner reaches the results screen;
- the percentage passed to `completed()` matches the learner's final result.

> **Note:** The callback receives the percentage score, not the raw `correct / total` value. For example, a result of `4/5` is passed to `completed()` as `80`.

Any change to callback timing, score calculation or completion behaviour must be explicitly tested in the target platform.

### Rule of thumb

If a requested change is only visual or authoring-related, prefer changing:

```text
index.html
style.css
Builder-side script.js logic
Preview styling
```

without changing the platform runtime unless that change is truly required.

---

## 15. Preview / Export parity

A central project requirement is that users should not be surprised by differences between authoring, Preview and Export.

When changing learner-facing behaviour, compare all three:

```text
Builder
Preview
Export
```

Check:

- text wrapping;
- font size;
- font weight;
- line spacing;
- question position;
- answer position;
- vertical centring;
- feedback;
- images;
- MathML;
- lists;
- bold/italic/underline;
- overflow;
- randomisation;
- navigation;
- result/review screens.

A fix that works only in Builder is not complete.

---

## 16. Autosave and drafts

The Builder stores a working draft locally in the browser.

Changes to important quiz settings and editable content trigger autosave behaviour.

Resetting the quiz clears the saved draft.

Because this uses browser-local storage, the draft is tied to the browser/profile and should not be treated as a shared or permanent backup.

For important work, keep the source storyboard and/or exported JSON.

---

## 17. Builder viewport scaling

The authoring canvas remains logically **720 × 540 px**, but the Builder can scale it down to fit smaller browser windows.

This scaling is visual only.

It does **not** change:

- the learner design size;
- validation dimensions;
- Preview design dimensions;
- Export design dimensions.

Do not use the displayed scaled size in the browser as a replacement for the logical learner measurements.

---

## 18. Browser and dependency notes

The project is primarily intended for a modern Chromium-based browser.

Current external browser dependencies include resources such as:

- Google Fonts / Roboto;
- JSZip.

Some functions in `script.js` may be legacy or optional utilities that are not exposed in the current `index.html`. Do not assume every helper is part of the current staff workflow simply because it still exists in the JavaScript.

---

## 19. Safe development workflow

Before making a change:

1. Identify whether the change affects:
   - Builder only;
   - Preview;
   - Export;
   - all three.
2. Check whether any fixed learner dimensions are involved.
3. Check whether the change touches the protected platform runtime.
4. Keep a copy of the last known-good version.

After making a change:

1. Load the Builder through Live Server.
2. Create a simple test quiz.
3. Test title editing.
4. Test all four answers.
5. Test feedback.
6. Test rich-text formatting.
7. Test line spacing.
8. Test HTML mode.
9. Test a long question.
10. Test a long answer.
11. Test long feedback.
12. Test MathML if the change could affect HTML/rendering.
13. Run Validate.
14. Preview with randomisation off.
15. Preview with randomisation on.
16. Export.
17. Confirm the ZIP contains `story.html` and all required PNGs.
18. Open/test the exported quiz.
19. Confirm platform completion/scoring if platform logic was touched.

---

## 20. Recommended regression test content

Keep a small reusable test quiz containing:

- short plain-text question;
- long question near the fit limit;
- short answers;
- one long answer near the fit limit;
- bold text;
- italic text;
- underline;
- superscript/subscript;
- bullet or numbered list;
- inline MathML;
- display MathML;
- centred display equation;
- longer feedback;
- an essential inline visual if supported by the imported content.

This makes layout regressions easier to find.

---

## 21. Common troubleshooting

### Export says required images are missing

Check that all 18 required PNG files exist in:

```text
img/
```

Run the Builder through Live Server rather than opening `index.html` directly.

### Preview does not open

The browser may have blocked the pop-up.

Allow pop-ups for the local Builder URL.

### Builder shows a scrollbar

Run Validate.

The learner output is not intended to depend on scrolling inside the question, answer or feedback container.

### Text wraps differently after a change

Check:

- font size;
- font weight;
- line height;
- padding;
- usable width;
- scrollbar behaviour;
- imported inline styles.

Then compare Builder, Preview and Export.

### A fraction bar becomes extremely wide

Inspect the imported MathML for stretching styles such as:

```text
width: 100%
min-width
flex-grow
```

The import normaliser is designed to remove common causes of this problem.

### An imported file has the wrong correct answer

Confirm that `correctIndex` uses zero-based indexing:

```text
0, 1, 2, 3
```

not:

```text
1, 2, 3, 4
```

---

## 22. Naming conventions worth preserving

Common IDs and patterns in `script.js` include:

```text
quizTitle
question_1
q1_answer_1
q1_answer_2
q1_answer_3
q1_answer_4
q1_feedback
q1_correct
```

Question pages use patterns such as:

```text
questionPage_0
questionPage_1
questionPage_2
```

Many functions derive question numbers from these IDs.

Renaming them requires corresponding JavaScript changes.

---

## 23. Related Google Docs storyboard workflow

The Quiz Builder can also be used with the separate Google Docs + Apps Script storyboard workflow.

That workflow allows authors/reviewers to prepare structured quiz content in Google Docs and export Quiz Builder-compatible JSON.

The Builder remains responsible for final:

- import;
- learner-layout validation;
- Preview;
- platform export.

The Google Docs authoring tool is a separate codebase and should have its own documentation.

---

## 24. Maintenance principles

When maintaining this project:

- preserve working behaviour before refactoring;
- prefer readable comments over clever code;
- keep Builder/Preview/Export geometry aligned;
- use the learner dimensions as the source of truth for fit;
- keep import normalisation conservative;
- do not rewrite source wording during conversion/import;
- preserve semantic MathML;
- keep required image filenames and the shared `img/` paths stable;
- keep export backwards-compatible unless a deliberate platform change is approved;
- test the exported package, not only the Builder.

---

## 25. Quick reference

### Canvas

```text
720 × 540
```

### Quiz sizes

```text
5 questions
10 questions
```

### Answers per question

```text
4
```

### Correct answer values in JSON

```text
0–3
```

### Main files

```text
index.html
style.css
script.js
README.md
```

### Export

```text
<name>.zip
└── <name>/
    ├── story.html
    └── img/
```

### Required export PNG count

```text
18
```

---

## 26. When this README should be updated

Update this file whenever a change affects:

- project structure;
- supported question counts;
- learner dimensions;
- import format;
- JSON schema;
- required assets;
- Preview behaviour;
- export package structure;
- platform callbacks;
- validation;
- randomisation;
- supported rich-text formatting;
- dependencies;
- recommended authoring workflow.

Keeping this README current is part of keeping the Quiz Builder maintainable.
