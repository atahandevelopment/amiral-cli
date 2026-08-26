<a id="top"></a>

[English](./README.md) | [Türkçe](./README_TR.md) | [Deutsch](./README_DE.md) | [Français](./README_FR.md)

![Amiral AI](./assets/amiral-ai.png)

# Amiral AI

> Ein abhängigkeitsbewusster Engineering-Workflow für AI-Coding-Teams.

Amiral ist ein abhängigkeitsbewusster Multi-Agent-Orchestrator für Software Engineering. Er koordiniert Coding-Agents, statt sie zu ersetzen, und stellt ihnen einen strukturierten Bereitstellungsprozess mit isolierter Ausführung, persistenten Workflows, kontrollierter Integration, unabhängigem Review und QA bereit.

**Starten Sie nicht einfach mehr Agents. Geben Sie ihnen einen Engineering-Prozess.**

```text
Plan → Decompose → Schedule → Execute → Integrate → Review → Fix → QA → Complete
```

## Inhaltsverzeichnis

- [Warum Amiral?](#why-amiral)
- [Funktionsweise](#how-it-works)
- [Wesentliche Unterscheidungsmerkmale](#key-differentiators)
- [Schnellstart](#quick-start)
- [Unterschiede von Amiral](#comparison)
- [Positionierung des Frameworks](#framework-positioning)
- [Philosophie](#philosophy)
- [Voraussetzungen und Installation](#installation)
- [Initialisierung](#initialization)
- [Konfiguration und Projekterkennung](#configuration)
- [Befehlsreferenz](#commands)
- [Persistenz, Anhalten und Fortsetzen](#persistence)
- [Fehlerbehebung](#troubleshooting)
- [Architektur und Repository-Struktur](#architecture)

<a id="why-amiral"></a>
## Warum Amiral?

Wie lassen sich mehrere Coding-Agents sicher koordinieren, die am selben Softwareprojekt arbeiten? Das Starten mehrerer Agents klärt nicht, wer für welche Aufgabe zuständig ist, was zuerst abgeschlossen werden muss, welche Arbeiten sich sicher überschneiden dürfen oder wie unabhängige Änderungen zu einem geprüften Ergebnis zusammengeführt werden.

Amiral stellt diese Koordinationsschicht bereit. Es zerlegt Anforderungen, modelliert Abhängigkeiten, plant die Ausführung innerhalb der verfügbaren Kapazität ein, isoliert Änderungen, integriert sie gezielt, erzwingt Reviewer- und QA-Gates, zeichnet Fehler auf und setzt unterbrochene Arbeiten fort. Der Nutzen entsteht durch explizite Prozesse und Verantwortlichkeiten, nicht allein durch die Anzahl der Agents.

<a id="how-it-works"></a>
## Funktionsweise

```text
User Request
     │
     ▼
   Planner ──► Dependency Graph
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
   Backend worktree    Frontend worktree
          └─────────┬─────────┘
                    ▼
              Integration
                    ▼
                 Review
             changes requested?
               │           │
              yes          no
               ▼            ▼
           Fix Tasks       QA
               └───────────►│
                            ▼
                         Complete
```

<a id="key-differentiators"></a>
## Wesentliche Unterscheidungsmerkmale

### Planung ist ein eigenständiges Artefakt

`amiral plan "Add authentication"` validiert und speichert einen prüfbaren, wiederverwendbaren Plan unter `plans/`; der Plan wird **nicht** implementiert. Dadurch kann der Plan durch Menschen geprüft oder freigegeben werden, bevor `amiral run --plan <plan-id>` den gespeicherten Graphen ausführt.

### Abhängigkeitsbewusste Ausführung

Parallelität bedeutet nicht, „so viele Agents wie möglich zu starten“. Eine Aufgabe ist erst zur Ausführung einplanbar, wenn ihre Abhängigkeiten abgeschlossen sind. Unabhängige Aufgaben können gleichzeitig ausgeführt werden, sofern dies sicher ist und innerhalb der konfigurierten Agent-/Provider-Kapazität geschieht.

```text
DB-001 ─────► API-001 ─────► UI-002
                    │
                    └──────► TEST-001

UI-001 ────────────────────► UI-002
```

### Spezialisierte Rollen und isolierte Bereitstellung

Die bereitgestellten Rollen sind Lead, Planner, Frontend, Backend, Database, DevOps, Reviewer und QA. Der Planner plant, implementiert jedoch nicht; Implementierungs-Agents bearbeiten die ihnen zugewiesenen Aufgaben; der Reviewer bewertet das integrierte Ergebnis unabhängig; QA verifiziert es unabhängig.

Implementierungs-Agents verwenden isolierte Git-Worktrees. Die Worktree-Isolation wird nicht als einzigartig dargestellt; ihr Wert liegt hier in ihrer Einbindung in den vollständigen Lebenszyklus:

```text
repository
├── main workspace
├── .amiral/worktrees/<workflow-id>/...
└── .amiral/integration/<workflow-id>/...

task execution → isolated worktrees → integration workspace → review → QA
```

### Unabhängige Review- und QA-Gates

Das Review ist ein Gate, keine Empfehlung. Seine Statuswerte sind `PASS`, `CHANGES_REQUESTED` und `BLOCKED`. Angeforderte Änderungen erzeugen Korrekturaufgaben und ein weiteres Review, begrenzt durch `quality.max_review_rounds` (eine positive Ganzzahl, Standardwert `3`); Amiral erhebt keinen Anspruch auf unbegrenzte autonome Korrekturen.

Bei anwendbaren, nicht trivialen Workflows bedeutet Abschluss, dass Implementierung und Integration erfolgreich waren, das Review `PASS` und QA `PASS` zurückgegeben haben. „Der Agent hat die Programmierung abgeschlossen“ bedeutet nicht, dass die Arbeit abgeschlossen ist; dieser Prozess garantiert nicht mehr als das, was durch die tatsächlich ausgeführten Prüfungen abgedeckt ist.

### Persistente Workflows, explizite Ergebnisse und eine automatisierungsfreundliche CLI

Workflow-Zustand und Verlauf werden als lokale JSON-Dateien gespeichert. Beim Fortsetzen wird der vorhandene Zustand weitergeführt, statt neu zu planen:

```bash
amiral status
amiral workflow history <workflow-id>
amiral run --workflow <workflow-id>
```

Aufgabenstatus sind `pending`, `in_progress`, `retry_wait`, `completed`, `failed`, `blocked` und `cancelled`. Workflow-Status sind `planned`, `running`, `blocked`, `failed`, `completed` und `cancelled`. Diese persistenten Status unterscheiden sich von den Gründen, aus denen `run` anhält: `completed`, `retry_scheduled`, `failed`, `blocked`, `needs_input`, `max_review_rounds`, `no_progress` und `interrupted`. Ihre explizite Unterscheidung verhindert, dass fehlgeschlagene oder pausierte Automatisierungen als abgeschlossen erscheinen.

Globale JSON-Ausgabe, Diagnosen, Steuerungsmöglichkeiten für Wiederholungen und Verlauf sowie stabile Exit-Code-Kategorien unterstützen Skripte, CI-Umgebungen und zukünftige Steuerungsebenen, ohne eine integrierte CI-Orchestrierung zu behaupten.

<a id="quick-start"></a>
## Schnellstart

```bash
npm install --global amiral-ai
cd my-project
git init # only when needed
amiral init
amiral doctor
amiral plan "Add authentication"
amiral run --plan <generated-plan-id>
```

Alternative in einem Schritt:

```bash
amiral run "Add authentication"
```

`plan` = vor der Implementierung prüfen; `run` = ausführen.

<a id="comparison"></a>
## Unterschiede von Amiral

| Fähigkeit | Einzelner Coding-Agent | Launcher für parallele Agents | Allgemeines Multi-Agent-Framework | Amiral |
| --- | --- | --- | --- | --- |
| Spezialisierte Agents | Begrenzt | Üblicherweise | Frameworkabhängig | Bereitgestellte Rollen |
| Isolierte Git-Worktrees | Üblicherweise nein | Häufig | Benutzerdefiniert | Ja |
| Persistenter Abhängigkeitsgraph und Scheduling | Üblicherweise nein | Unterschiedlich | Muss erstellt/konfiguriert werden | Ja |
| Gespeicherter Plan ohne Ausführung | Unterschiedlich | Unterschiedlich | Muss erstellt/konfiguriert werden | Ja |
| Kontrollierter Integrations-Workspace | Üblicherweise nein | Unterschiedlich | Benutzerdefiniert | Ja |
| Unabhängiges Review → Korrektur-Gate | Unterschiedlich | Unterschiedlich | Benutzerdefiniert | Ja |
| Unabhängiges QA-Gate | Selten | Unterschiedlich | Benutzerdefiniert | Ja |
| Persistenter/fortsetzbarer Workflow | Unterschiedlich | Unterschiedlich | Benutzerdefiniert | Ja |
| Wiederholungen/Verlauf und maschinenlesbare CLI | Begrenzt | Unterschiedlich | Frameworkabhängig | Ja |

Launcher für parallele Agents beantworten, wie Arbeiten gleichzeitig ausgeführt werden; Amiral beantwortet außerdem, wer dafür zuständig ist, was zuerst abgeschlossen sein muss, wie Ergebnisse integriert werden, wer sie prüft und testet und was nach einem Fehler oder einer Unterbrechung geschieht.

<a id="framework-positioning"></a>
## Positionierung des Frameworks

Allgemeine Multi-Agent-Frameworks stellen Grundbausteine für beliebige Agent-Systeme bereit und können die richtige Abstraktion sein, wenn eine individuelle Plattform entwickelt wird. Amiral ist gezielt auf die Softwarebereitstellung ausgerichtet:

```text
Requirement → Engineering Plan → Task Dependencies → Specialist Implementation
→ Git Integration → Code Review → QA → Completed Change
```

<a id="philosophy"></a>
## Philosophie

Pläne sollten prüfbar sein. Abhängigkeiten sollten die Ausführung steuern. Parallele Agents sollten isoliert sein. Die Integration sollte gezielt erfolgen. Der Code schreibende Agent sollte nicht die einzige prüfende Instanz sein. Fehler sollten Fehler bleiben, bis sie behoben sind, und unterbrochene Workflows sollten fortsetzbar sein.

> AI-Agents sollten wie ein Engineering-Team arbeiten, nicht wie eine Sammlung voneinander unabhängiger Terminals.

[↑ Nach oben](#top)

<a id="installation"></a>

## Der wichtigste Unterschied: `plan` führt nichts aus

> **`amiral plan` erstellt und validiert einen wiederverwendbaren Plan, schreibt ihn unter `plans/`, gibt die Plan-ID aus und wird beendet. Der Befehl erstellt oder führt absichtlich keinen Workflow aus.**
>
> **`amiral run` führt aus.** Bei Übergabe einer Anforderung wird zunächst geplant und anschließend ein Workflow erstellt und ausgeführt. Der Befehl kann auch einen gespeicherten Plan ausführen oder einen persistenten Workflow fortsetzen.

Wählen Sie den Befehl entsprechend Ihrer Absicht:

| Sie möchten ... | Verwenden Sie |
| --- | --- |
| Einen Aufgabengraphen prüfen oder freigeben, bevor eine Implementierung beginnt | `amiral plan "Add authentication"` |
| Diesen freigegebenen Plan ausführen | `amiral run --plan feature-ab12cd34` |
| In einem Befehl planen und ausführen | `amiral run "Add authentication"` |
| Einen unterbrochenen, pausierten oder zur Wiederholung vorgesehenen Workflow fortsetzen | `amiral run --workflow feature-ab12cd34` |
| Den aktuell ausgewählten Workflow fortsetzen | `amiral run` |

```bash
# Two-step, review-before-execution flow
amiral plan "Add authentication" --type feature
# Output includes: Plan created: feature-ab12cd34
amiral run --plan feature-ab12cd34

# One-step flow: the same request is planned and then executed
amiral run "Add authentication" --type feature
```

`--plan` für `run` akzeptiert entweder eine Plan-ID unter `plans/` oder eine vorhandene Plan-/Graphdatei. Verwenden Sie `amiral run --plan ...` nicht in der Erwartung, dass dadurch ein Plan erstellt wird; der Befehl verwendet einen vorhandenen Plan.

## Voraussetzungen

- Node.js **20 oder neuer** und npm.
- Git, wobei das Zielverzeichnis als Repository initialisiert sein muss. `amiral init` führt niemals `git init` aus.
- Die konfigurierte Provider-CLI. Die bereitgestellte Konfiguration verwendet die ausführbare Datei `opencode`; installieren und authentifizieren Sie sie gemäß den Anweisungen von OpenCode und stellen Sie sicher, dass sie über `PATH` erreichbar ist.
- Ein sauberer Working Tree vor der Integration. Amiral bewahrt nicht zugehörige Benutzeränderungen und integriert nicht in einen nicht sauberen Tree.
- Provider-Zugriff, Modelle und Zugangsdaten, die für Ihre OpenCode-Einrichtung geeignet sind. Speichern Sie keine Geheimnisse in versionierter Konfiguration.

Bestätigen Sie die Betriebsbereitschaft nach der Initialisierung mit `amiral doctor` und `amiral config validate`.

## Installation und Aufruf

### Globale Installation

```bash
npm install --global amiral-ai
amiral --version
amiral --help
```

### Projektlokale Installation

```bash
npm install --save-dev amiral-ai
npx amiral --version
```

Sie können außerdem ein Paketskript hinzufügen, zum Beispiel `"amiral": "amiral"`, und anschließend `npm run amiral -- status` ausführen.

### Ausführung ohne Installation

```bash
npx --yes amiral-ai --version
npx --yes amiral-ai init --minimal
```

`npm run build` ist ausschließlich für die Entwicklung dieses Repositorys vorgesehen; nach der Installation des veröffentlichten Pakets ist der Befehl nicht erforderlich. Bevorzugen Sie bei einer lokalen Installation `npx amiral`, damit die projektlokale Binärdatei verwendet wird. Ohne lokale Installation bezeichnet `npx amiral-ai ...` das npm-Paket eindeutig.

### Paket und Version überprüfen

```bash
amiral --version                         # active global/PATH binary
npx amiral --version                     # local binary, when installed
npm view amiral-ai version               # current registry version
npm list amiral-ai                       # local installed version
npm list --global amiral-ai              # global installed version
```

Die Paketversion wird aus der installierten Datei `package.json` gelesen; dieses Repository deklariert derzeit **0.1.5**. Wenn nach einem Upgrade weiterhin eine alte Version gemeldet wird, ermitteln Sie, welche ausführbare Datei aufgelöst wird (`where amiral` unter Windows, `which -a amiral` unter macOS/Linux), entfernen Sie kollidierende globale/lokale Installationen, leeren Sie nur den normalen npm-Cache, falls npm eine Beschädigung meldet, und installieren Sie das Paket erneut. Vermeiden Sie es, unbesehen eine veraltete globale Binärdatei mit einem neueren lokalen Paket zu kombinieren.

```bash
npm update --save-dev amiral-ai           # update a local dependency within its range
npm install --global amiral-ai@latest     # replace the global package
npx --yes amiral-ai@latest --version      # explicitly use the latest registry release
```

Eine Neuinstallation der CLI migriert oder löscht den Laufzeitstatus eines Projekts nicht. Prüfen Sie die Änderungen einer neuen Version, bevor Sie eine neuere CLI mit vorhandenen Daten unter `tasks/` verwenden.

<a id="initialization"></a>
## Projekt initialisieren

Führen Sie die Initialisierung im vorgesehenen Projektstamm aus:

```bash
git init                                  # only if this is not already a Git repository
amiral init --minimal
amiral doctor
amiral config validate
```

```text
amiral init [--minimal] [--force]
```

- `--minimal`: installiert nur `team.yaml`, Workflow-Definitionen, Schemas und den maschinellen Planungs-Agent; gebündelte Skills werden weder gelesen noch validiert oder installiert.
- `--force`: überschreibt vorhandene Vorlagendateien. Verwenden Sie diese Option mit Bedacht; ohne sie bleiben vorhandene Dateien erhalten.

Bei einer vollständigen Initialisierung werden die in `team.yaml` und `.opencode/` freigegebenen Vorlagen installiert (Agents, Workflows, Verträge, Orchestrierung, Richtlinien, Prompts, Schemas und OpenCode-Konfiguration). Anschließend wird der paketierte Verzeichnisbaum `vendor/skills/**` nach `vendor/skills/**` im Ziel kopiert. Die Initialisierung fügt außerdem einen durch Markierungen begrenzten Amiral-Block zu `.gitignore` hinzu; der Block wird nicht dupliziert und Inhalte außerhalb des Blocks werden nicht überschrieben. Unsichere Ziele mit symbolischen Links werden abgelehnt, und Paketmanifeste, Abhängigkeiten oder Laufzeitstatus werden niemals installiert.

<a id="configuration"></a>
## Erkennung des Projektstamms

Mit Ausnahme von `init` können Befehle im Projektstamm oder in einem beliebigen Unterverzeichnis ausgeführt werden, einschließlich Pfaden mit Leerzeichen. Amiral durchsucht die Verzeichnisse aufwärts:

1. Der nächstgelegene Vorfahr mit `team.yaml` wird verwendet.
2. Wenn kein `team.yaml` gefunden wird, dient der erste Vorfahr mit `.amiral` oder `.opencode` als Ausweichlösung.
3. Wenn keines davon vorhanden ist, schlägt der Befehl fehl und empfiehlt `amiral init`.

Der Prozess arbeitet anschließend vom erkannten Stammverzeichnis aus. `doctor` bildet eine Ausnahme: Der Befehl kann das aktuelle Verzeichnis auch dann diagnostizieren, wenn kein Amiral-Stamm gefunden wurde, und `doctor --fix` kann dort fehlende unterstützende Verzeichnisse/minimale Dateien erstellen.

## Anforderungen: positionales `goal` gegenüber `--request`

Die vollständige ursprüngliche Benutzeranforderung ist die maßgebliche Eingabe für die Planung.

- Verwenden Sie bei der üblichen Nutzung das positionale `[goal]` für die gesamte Anforderung.
- Wenn das positionale Ziel nur ein kurzer Titel ist, geben Sie die vollständigen Anforderungen in `--request` an.
- Wenn beide angegeben werden, ist ein nicht leeres `--request` die vollständige maßgebliche Anforderung; das kurze Ziel wird nicht damit verkettet.
- Wenn `--request` fehlt, wird `goal` zur vollständigen Anforderung.
- `--plan-file` importiert einen Plan und erfordert daher keines der beiden Textargumente.

```bash
# Full request in the positional argument
amiral plan "Add password reset with expiring one-use tokens and integration tests"

# Short display-level idea plus the complete authoritative request
amiral run "Password reset" \
  --request "Add email-based password reset. Tokens expire after 15 minutes, are one-use, and must be covered by integration tests." \
  --type feature
```

Die Shell-Quoting-Regeln sind relevant. Setzen Sie Anforderungen mit Leerzeichen in Anführungszeichen; verwenden Sie für lange Anforderungen die Fortsetzungssyntax Ihrer Shell oder eine einzelne Zeile. Vermeiden Sie Geheimnisse in Befehlsargumenten, da Shells und Prozesswerkzeuge sie möglicherweise aufzeichnen.

## Betriebsmodell

```text
User request
    ↓
Lead / workflow selection
    ↓
Planner → validated dependency graph
    ↓
Specialists in isolated Git worktrees
    ↓
Integration worktree
    ↓
Reviewer ── CHANGES_REQUESTED → fix tasks → review again
    ↓ PASS
QA ──────── FAIL/BLOCKED → stop for input
    ↓ PASS
Complete
```

Grundprinzipien:

- Prüfen Sie das vorhandene Repository, bevor Sie Architekturentscheidungen treffen; halten Sie sich an bestehende Konventionen.
- Der Lead ist die alleinige Orchestrierungsinstanz. Der Planner analysiert und zerlegt Anforderungen, implementiert jedoch nicht.
- Frontend-, Backend-, Database- und DevOps-Spezialisten implementieren ausschließlich die ihnen zugewiesenen Arbeiten.
- Eine Aufgabe ist erst zur Ausführung einplanbar, wenn alle Abhängigkeiten abgeschlossen sind. Unabhängige Aufgaben dürfen nur dann gleichzeitig ausgeführt werden, wenn dies sicher ist und innerhalb der konfigurierten Provider-/Agent-Kapazität geschieht.
- Arbeiten werden in Aufgaben-Worktrees isoliert und idempotent in einen Integrations-Worktree zusammengeführt.
- Reviewer und QA sind unabhängige Gates. Ein nicht trivialer Workflow ist erst nach Implementierung, Integration, Review `PASS` und QA `PASS` abgeschlossen.
- Review `CHANGES_REQUESTED` erstellt bis zu `quality.max_review_rounds` Korrekturaufgaben; blockierende oder ausgeschöpfte Gates werden nicht fälschlich als Erfolg behandelt.
- Bewahren Sie nicht zugehörige Änderungen, vermeiden Sie destruktive Git-Aktionen und legen Sie niemals Zugangsdaten offen.

Die bereitgestellte Datei `team.yaml` definiert Agents, Fähigkeiten, Provider-Routing/-Kapazität, Leases, Wiederholungen, Git-Aufbewahrung sowie die Workflows `feature`, `bugfix` und `refactor`. Der Scheduler verwendet Aufgabenabhängigkeiten und erforderliche Fähigkeiten; die effektive Parallelität wird durch `execution.max_parallel_agents` und die Provider-Parallelität begrenzt (beide haben in der bereitgestellten Konfiguration den Standardwert 1).

## Globale Flags und Ausgabe

Diese Flags können vor oder nach einem Unterbefehl angegeben werden; befehlsspezifische Formen von `--json`/`--verbose` werden ebenfalls akzeptiert, sofern sie deklariert sind.

| Flag | Bedeutung |
| --- | --- |
| `-q, --quiet` | Unterdrückt die normale Ausgabe bei Befehlen, die den Standard-Ausgabe-Renderer verwenden. `config path` und `config show` ohne JSON schreiben derzeit direkt nach stdout. |
| `-v, --verbose` | Bezieht Diagnose-/Fortschrittsereignisse ein, sofern unterstützt. |
| `--json` | Gibt bei erfolgreicher Befehlsausgabe ein JSON-Dokument aus. |
| `-V, --version` | Gibt die Paketversion aus. |
| `-h, --help` | Zeigt die Hilfe an; verwenden Sie das Flag nach einem beliebigen Befehl/Unterbefehl für kontextspezifische Hilfe. |

Verwenden Sie für Automatisierungen `--json` und prüfen Sie den Exit-Code:

```bash
amiral --json status > status.json
amiral doctor --json > doctor.json
amiral config show --json > config.json       # secret-like keys are redacted
amiral workflow list --json
```

Die normale JSON-Ausgabe wird als einzelnes Dokument nach stdout geschrieben. Fehler werden nach stderr geschrieben; im JSON-Modus haben sie die Form `{"error":{"message":"...","code":N}}`. Ausführliche Provider-Fortschrittsmeldungen werden bei Planungs-, Ausführungs- und Gate-Befehlen mit JSON-Ausgabe unterdrückt, damit stdout parsebar bleibt. Interaktive Befehle benötigen in Automatisierungen ohne TTY weiterhin `--force`, sofern dies dokumentiert ist.

`doctor` ist eine diagnostische Ausnahme: Der Befehl wird derzeit nach Abschluss seiner Prüfungen mit `0` beendet, selbst wenn einige Prüfungen fehlschlagen. Automatisierungen müssen den JSON-Wert `failures` oder jeden Wert in `checks[].state` prüfen; verwenden Sie nicht allein den Exit-Code als Ergebnis der Betriebsbereitschaft.

Exit-Codes sind stabile CLI-Kategorien:

| Code | Bedeutung |
| ---: | --- |
| 0 | Erfolg; wird auch verwendet, wenn `run` wegen einer eingeplanten vorübergehenden Wiederholung pausiert. |
| 1 | Allgemeiner Fehler oder kein Fortschritt. |
| 2 | Ungültige Verwendung oder abgelehnte/erforderliche Bestätigung. |
| 3 | Fehlende/ungültige Konfiguration. |
| 4 | Workflow blockiert, Gate nicht bestanden, Lock-/Administrationskonflikt oder Eingabe erforderlich. |
| 5 | Provider-Fehler. |
| 6 | Validierungs-/Schemafehler. |
| 130 | Unterbrochen. |

<a id="commands"></a>
## Befehlsreferenz

### `amiral plan`

```text
amiral plan [goal]
  --type <feature|bugfix|refactor>   default: feature
  --request <text>                   complete original request
  --name <name>                      prefix used in generated plan ID
  --plan-file <file-or-plan-id>      import and validate planner-format JSON
  --json
```

Führt den Planungs-Provider aus (sofern nicht importiert wird), validiert und analysiert den Graphen, speichert Artefakte unter `plans/<plan-id>/`, meldet Aufgabenanzahl, Tiefe, Parallelgruppen und Konfliktwarnungen und wird **ohne Implementierung beendet**.

```bash
amiral plan "Repair duplicate invoice creation" --type bugfix --name invoice-race
amiral plan --plan-file ./approved-plan.json --type refactor --json
```

Mit `--plan-file` importierte Inhalte müssen JSON im Planner-Format sein; `plan` schreibt ein neues normalisiertes Planverzeichnis. Verwenden Sie `run --plan`, um einen bereits gespeicherten Graphen direkt auszuführen.

### `amiral run`

```text
amiral run [goal]
  --plan <id-or-file>
  --workflow <id>
  --type <feature|bugfix|refactor>   default: feature
  --request <text>
  --name <name>
  --plan-file <file-or-plan-id>
  --json
```

Es kann genau ein Ausführungsmodus ausgewählt werden:

1. `[goal]`, `--request` oder `--plan-file`: Einen Plan erstellen, einen Workflow erstellen und diesen anschließend ausführen.
2. `--plan <id-or-file>`: Ein gespeichertes Planner-Ergebnis/einen Aufgabengraphen validieren, einen Workflow erstellen und diesen anschließend ausführen.
3. `--workflow <id>`: Diesen persistenten Workflow fortsetzen.
4. Kein Modus: Den aktiven Workflow fortsetzen (oder den einzigen Workflow, wenn keiner ausgewählt ist).

`--name` benennt neu erzeugte Plan-/Workflow-IDs; ein vorhandener Workflow wird dadurch nicht umbenannt. `--type` steuert die neue Online-Planung und dient als Ausweichwert, wenn ein importierter Graph keinen Workflow-Typ enthält.

```bash
amiral run "Add favorites" --type feature
amiral run --plan feature-ab12cd34
amiral run --plan ./plans/reviewed/task-graph.json --name favorites-approved
amiral run --workflow feature-cd34ef56 --verbose
amiral run                              # active workflow
```

`run` hält den Laufzeit-Lock und durchläuft Scheduling, Provider-Dispatch, Integration, Review-/Korrekturrunden und QA. Der Befehl kehrt nach Abschluss oder bei einer sicheren Pausenbedingung zurück; er ist kein Daemon.

### `amiral status`

```text
amiral status [--workflow <id>] [--json] [--verbose]
```

Zeigt den Workflow-Status, den Namen des konfigurierten Standard-Providers, Aufgabenanzahlen und Details zu Wiederholungen/Provider-Fehlern, den Qualitätsstatus und aktive Worktrees. Der Befehl führt keine Live-Prüfung des Provider-Zustands oder der Authentifizierung durch; verwenden Sie `doctor` für Diagnosen. Ohne `--workflow` wird der aktive/einzige Workflow aufgelöst.

```bash
amiral status
amiral status --workflow feature-cd34ef56 --json
```

### `amiral workflow`

Unterbefehle für Administration und Prüfung:

```text
amiral workflow list
amiral workflow use <id>
amiral workflow show <id> [--json]
amiral workflow cancel <id> [--force]
amiral workflow reset-task <task-id> [--workflow <id>] [--force]
amiral workflow history [id] [--limit <positive-integer>]   default: 20
```

- `list`: listet IDs, Status, aktive Auswahl und Aktualisierungszeitpunkte auf.
- `use`: schreibt die aktive Workflow-Auswahl, die Befehle ohne ID verwenden.
- `show`: zeigt, sofern verfügbar, Ziel/Zusammenfassung des Graphen und Aufgabendetails.
- `cancel`: bricht einen Workflow ab und gibt Leases frei. In einem TTY wird eine Bestätigung angefordert; die nicht interaktive Verwendung erfordert `--force`.
- `reset-task`: setzt eine Aufgabe manuell in einen Zustand zurück, in dem sie erneut ausgeführt werden kann. `--workflow` löst Mehrdeutigkeiten auf; `--force` erlaubt andernfalls eingeschränkte Rücksetzfälle. Dieser Unterbefehl fordert keine Bestätigung an.
- `history`: zeigt die neuesten angeforderten Verlaufseinträge bis `--limit`; lassen Sie die ID weg, um die aktive Auflösung zu verwenden.

```bash
amiral workflow list
amiral workflow use feature-cd34ef56
amiral workflow show feature-cd34ef56 --json
amiral workflow history feature-cd34ef56 --limit 50
amiral workflow cancel obsolete-workflow --force
amiral workflow reset-task API-002 --workflow feature-cd34ef56 --force
```

### `amiral retry`

```text
amiral retry <task-id> [--workflow <id>] [--force]
amiral retry --failed [--workflow <id>]
amiral retry --blocked [--workflow <id>]
```

Wählen Sie genau eine Aufgaben-ID, `--failed` oder `--blocked`. Der Befehl setzt passende Aufgaben zurück, behält jedoch ihre Worktrees bei; er führt sie nicht aus. Führen Sie danach `amiral run --workflow <id>` aus (oder `amiral run` für den aktiven Workflow).

```bash
amiral retry API-002 --workflow feature-cd34ef56
amiral retry --failed --workflow feature-cd34ef56
amiral run --workflow feature-cd34ef56
```

### `amiral review` und `amiral qa`

```text
amiral review [--workflow <id>] [--json]
amiral qa     [--workflow <id>] [--json]
```

Führt ein eigenständiges Gate für den ausgewählten Workflow/Integrations-Workspace aus. Das Review meldet Urteil, Zusammenfassung und Befunde; QA meldet Urteil, Prüfungen und Befunde. Ein anderes Urteil als `PASS` führt zum Exit-Code 4. Diese Befehle führen nur ein Gate aus; sie ersetzen weder den vollständigen Lebenszyklus von `run` noch führen sie daraus resultierende Korrekturen automatisch aus.

```bash
amiral review --workflow feature-cd34ef56
amiral qa --workflow feature-cd34ef56 --json
```

### `amiral clean`

```text
amiral clean [--workflow <id> | --all]
  [--completed] [--remove-failed] [--remove-blocked]
  [--delete-branches] [--dry-run] [--force]
```

Die Bereinigung ist konservativ:

- Ohne Auswahl einer Bereinigungsrichtlinie wird nur eine Vorschau der Bereinigung abgeschlossener Worktrees angezeigt; es werden keine Dateien gelöscht.
- `--dry-run` zeigt immer eine Vorschau an.
- `--completed` aktiviert das Entfernen abgeschlossener Worktrees.
- `--remove-failed` / `--remove-blocked` aktivieren ausdrücklich das Löschen aufbewahrter fehlgeschlagener/blockierter Worktrees.
- `--delete-branches` aktiviert ausdrücklich das Löschen von Branches; andernfalls bleiben Branches erhalten.
- Standardmäßig gilt der aktive Workflow als Geltungsbereich; wählen Sie entweder `--workflow` oder `--all`, niemals beides.
- Die tatsächliche Bereinigung fordert in einem TTY eine Bestätigung an und benötigt in nicht interaktiven Umgebungen `--force`.
- Die aktuelle Vorschau meldet die Worktree-Nutzung insgesamt. Der angezeigte Geltungsbereich ist kontextbezogene Metadaten und kein exakter, nach `--workflow` gefilterter Löschplan je Worktree.

```bash
amiral clean --workflow feature-cd34ef56 --dry-run
amiral clean --workflow feature-cd34ef56 --completed
amiral clean --all --completed --remove-failed --delete-branches --force
```

### `amiral doctor`

```text
amiral doctor [--json] [--fix]
```

Prüft Projektstruktur, Git-/Provider-/Konfigurationszustand, Laufzeitverzeichnisse und veraltete Worktrees. `--fix` führt begrenzte unterstützende Reparaturen durch: Es stellt `.amiral/worktrees`, `.amiral/integration` und `tasks` sicher, führt eine minimale Initialisierung aus und stellt den durch Markierungen verwalteten `.gitignore`-Block sicher. Es ist kein allgemeines automatisches Reparaturwerkzeug. Es initialisiert Git nicht und authentifiziert auch keinen Provider.

```bash
amiral doctor --json
amiral doctor --fix
```

### `amiral config`

```text
amiral config path
amiral config show [--json]
amiral config validate [--json]
```

- `path`: gibt den erkannten absoluten Pfad zu `team.yaml` aus.
- `show`: gibt die normalisierte Konfiguration, die effektive Ausführungs-/Provider-Kapazität und registrierte Provider aus. Schlüssel, die token/key/secret/password entsprechen, werden rekursiv durch `[REDACTED]` ersetzt.
- `validate`: überprüft, ob der Standard-Provider registriert/aktiviert ist und die Konfiguration mindestens eine objektwertige Agent-Definition enthält; die Ausgabe enthält Provider-/Kapazitätsdaten. Nicht jedes Agent-Feld und jede zugehörige Agent-Datei wird umfassend validiert.

```bash
amiral config path
amiral config show --json
amiral config validate
```

Die Schwärzung ist eine Schutzmaßnahme für die Anzeige und keine Erlaubnis, Geheimnisse in `team.yaml` zu speichern.

<a id="persistence"></a>
## Persistenz, Anhalten und Fortsetzen

Pläne und Workflows sind unterschiedliche persistente Objekte:

```text
plans/<plan-id>/
├── planner-result.json
├── task-graph.json
├── planner-result.raw.txt
├── planner-result.raw.json
└── planner-diagnostics.json          # online planning; failed attempts may also be saved

tasks/
├── .active-workflow
└── <workflow-id>/
    ├── state.json
    ├── task-graph.json
    ├── history.json
    ├── requests/                     # directory name is configurable
    └── results/

.amiral/
├── amiral.lock
├── amiral.lock.guard                 # transient internal mutex; stale recovery may remove it
├── worktrees/<workflow-id>/...       # task worktrees
└── integration/<workflow-id>/...     # integrated tree and gate artifacts
```

Diese Pfade sind lokale Laufzeitartefakte, die der Initialisierer zu `.gitignore` hinzufügt. Es gibt keinen dokumentierten SQLite-Zustandsspeicher: JSON-Dateien sind maßgeblich. Bearbeiten Sie den Zustand nicht manuell, während ein Befehl `.amiral/amiral.lock` hält.

Die Workflow-Auflösung ohne `--workflow` verwendet `tasks/.active-workflow`; fehlt diese Datei, wird ein einziger vorhandener Workflow automatisch ausgewählt, während mehrere Workflows `amiral workflow use <id>` oder eine explizite ID erfordern.

`run` hält aus folgenden Gründen sicher an:

- `completed`: Alle Implementierungs-/Korrekturarbeiten wurden integriert, das Review wurde bestanden und QA wurde bestanden.
- `retry_scheduled`: Eine vorübergehende Provider-Wiederholung wartet; Exit-Code 0, mit `nextRetryAt`, sofern bekannt. Führen Sie den Befehl nach diesem Zeitpunkt erneut aus.
- `failed`: Nicht wiederholbarer Aufgabenfehler oder ausgeschöpfte Wiederholungsversuche; prüfen Sie Zustand/Ergebnisse, setzen Sie die Aufgabe mit `retry` zurück und führen Sie den Befehl erneut aus.
- `blocked`: Workflow-/Aufgabenblockierung; prüfen Sie Status/Verlauf und beheben Sie die Ursache oder setzen Sie die Aufgabe gegebenenfalls manuell zurück.
- `needs_input`: Abgebrochener Workflow, blockiertes/fehlgeschlagenes Gate, ausgeschöpfte Review-Korrekturen oder die Sicherheitsgrenze von 25 Iterationen. Die Meldung zur Sicherheitsgrenze erlaubt ausdrücklich eine weitere Ausführung.
- `max_review_rounds`: Angeforderte Review-Änderungen konnten innerhalb der konfigurierten Runden nicht vorangebracht werden; der Workflow ist blockiert.
- `no_progress`: Keine zur Ausführung einplanbare Aufgabe und keine ausstehende Wiederholung; prüfen Sie Abhängigkeiten und Verlauf.
- `interrupted`: Das erste `SIGINT`/`SIGTERM` fordert vor der nächsten Mutation ein sicheres Anhalten an und beendet den Prozess mit 130. Ein zweites Signal beendet ihn sofort; verwenden Sie es daher nur bei Bedarf.

Beim Fortsetzen wird nicht neu geplant:

```bash
amiral status --workflow feature-cd34ef56
amiral workflow history feature-cd34ef56 --limit 50
amiral run --workflow feature-cd34ef56
```

Befehle, die den gemeinsamen Laufzeitstatus verändern, verwenden einen Projekt-Lock. Wenn ein anderer Prozess ihn hält, warten Sie auf diesen Prozess oder diagnostizieren Sie einen tatsächlich veralteten Eigentümer; löschen Sie einen aktiven Lock nicht unbesehen.

<a id="troubleshooting"></a>
## Fehlerbehebung

### „Kein Amiral-Projekt gefunden“

Führen Sie den Befehl im vorgesehenen Verzeichnisbaum aus, prüfen Sie, ob in einem übergeordneten Verzeichnis `team.yaml` vorhanden ist, oder initialisieren Sie das Projekt. `amiral config path` bestätigt die Erkennung.

### Fehler bei ausführbarer Provider-Datei/Authentifizierung

Führen Sie `amiral doctor --verbose` und `amiral config show` aus; überprüfen Sie `providers.<name>.binary`, `enabled`, die PATH-Auflösung und die Provider-Anmeldung außerhalb von Amiral. Provider-Fehler können gemäß `team.yaml` wiederholt werden; Diagnosen für Planungsfehler werden persistent gespeichert.

### Mehr als ein Workflow und keiner aktiv

```bash
amiral workflow list
amiral workflow use <workflow-id>
```

Alternativ können Sie `--workflow` explizit angeben.

### Nicht sauberer Tree oder Merge-Konflikt

Committen/stashen Sie nur Ihre eigenen beabsichtigten Änderungen, bewahren Sie nicht zugehörige Arbeiten, prüfen Sie Aufgaben-/Integrations-Worktrees und wiederholen Sie den Vorgang, nachdem Sie die zugrunde liegende Git-Bedingung behoben haben. Verwenden Sie destruktive Resets nicht als routinemäßige Lösung.

### Eine Ausführung war erfolgreich, ist aber nicht abgeschlossen

Prüfen Sie in der JSON-/Textausgabe den Wert `reason`. `retry_scheduled` gibt absichtlich 0 zurück, obwohl die Ausführung pausiert. Warten Sie bis `nextRetryAt` und setzen Sie sie dann fort. Nur `reason: "completed"` bedeutet, dass alle Gates bestanden wurden.

### Eine Aufgabe ist fehlgeschlagen oder blockiert

```bash
amiral status --workflow <id> --json
amiral workflow history <id> --limit 100
amiral workflow show <id> --json
amiral retry <task-id> --workflow <id>
amiral run --workflow <id>
```

Verwenden Sie `--force` erst, nachdem Sie verstanden haben, weshalb ein Zurücksetzen/Abbruch/eine Bereinigung eingeschränkt ist.

### JSON-Parsing schlägt fehl

Geben Sie `--json` beim Befehl an, parsen Sie nur stdout und bewahren Sie stderr separat auf. Führen Sie beim Verarbeiten von JSON die Streams nicht zusammen (`2>&1`). Bestätigungsaufforderungen benötigen in CI `--force`.

<a id="architecture"></a>
## Architektur und Repository-Struktur

```text
AGENTS.md                     team-wide operating rules
team.yaml                     agents, providers, capacities, workflows
.opencode/
├── agents/                   role instructions
├── workflows/                feature, bugfix, refactor processes
├── orchestration/            execution/dependency/error protocols
├── contracts/                task, agent-result, review contracts
├── policies/                 architecture, Git, review, testing rules
├── prompts/ and schemas/     machine prompts and validation contracts
└── opencode.json             OpenCode configuration
src/cli/                      product CLI definitions
scripts/lib/                  orchestration runtime
templates/init/               files installed by `amiral init`
vendor/skills/                bundled skills installed by normal `amiral init`
tests/                        Node test suite
memory/                       architecture, conventions, decisions, lessons
```

Die aktiven paketierten Workflows sind `feature`, `bugfix` und `refactor`. Zu den Agents gehören Lead, Planner, Frontend, Backend, Database, DevOps, Reviewer und QA. Agent-Definitionen beschreiben Verantwortlichkeiten; Workflows beschreiben Prozesse; Richtlinien legen übergreifende Regeln fest; Verträge definieren maschinenlesbare Übergaben; Skills stellen nur bei Relevanz spezialisiertes Wissen bereit.

## Entwicklung aus dem Quellcode

Klonen Sie dieses Repository und installieren Sie die festgeschriebenen Abhängigkeiten:

```bash
git clone https://github.com/atahandevelopment/amiral-ai.git
cd amiral-ai
npm ci
npm run typecheck
npm test
npm run build
node dist/src/cli/index.js --help
```

Nützliche Skripte:

| Skript | Zweck |
| --- | --- |
| `npm run typecheck` | Führt eine Typprüfung durch, ohne den verteilbaren Build zu erzeugen. |
| `npm test` | Führt die Node-Testsuite über `tsx` aus. |
| `npm run build` | Kompiliert mit `tsconfig.build.json` nach `dist/`. |
| `npm run validate:team -- <task-graph|agent-result|review-result|planner-result> <file>` | Validiert ein JSON-Vertragsartefakt gegen das ausgewählte Schema. |
| `npm pack --dry-run` | Prüft die Veröffentlichungsinhalte; `prepack` bereinigt `dist` und erstellt es neu. |

Erstellen Sie für CLI-Tests aus dem Quellbaum zuerst den Build und rufen Sie `node dist/src/cli/index.js ...` auf; die veröffentlichte Binärdatei `amiral` verweist auf diesen kompilierten Einstiegspunkt. Die älteren Einstiegspunkte unter `scripts/*.ts` bleiben als Kompatibilitäts-/interne Werkzeuge erhalten, für die Produktnutzung sollte jedoch die CLI bevorzugt werden.

## Lizenz

Dieses Paket deklariert in `package.json` die ISC-Lizenz.
