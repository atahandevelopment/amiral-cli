<a id="top"></a>

[English](./README.md) | [Türkçe](./README_TR.md) | [Deutsch](./README_DE.md) | [Français](./README_FR.md)

![Amiral AI](./assets/amiral-ai.png)

# Amiral AI

> Un workflow d’ingénierie tenant compte des dépendances pour les équipes d’agents de programmation IA.

Amiral est un orchestrateur multi-agent d’ingénierie logicielle tenant compte des dépendances. Il coordonne les agents de programmation au lieu de les remplacer, en leur fournissant un processus de livraison structuré avec une exécution isolée, des workflows persistants, une intégration contrôlée, une revue indépendante et une assurance qualité.

**Ne vous contentez pas d’exécuter davantage d’agents. Donnez-leur un processus d’ingénierie.**

```text
Plan → Decompose → Schedule → Execute → Integrate → Review → Fix → QA → Complete
```

## Sommaire

- [Pourquoi Amiral ?](#why-amiral)
- [Fonctionnement](#how-it-works)
- [Principaux éléments différenciateurs](#key-differentiators)
- [Démarrage rapide](#quick-start)
- [Ce qui distingue Amiral](#comparison)
- [Positionnement par rapport aux frameworks](#framework-positioning)
- [Philosophie](#philosophy)
- [Prérequis et installation](#installation)
- [Initialisation](#initialization)
- [Configuration et détection du projet](#configuration)
- [Référence des commandes](#commands)
- [Persistance, arrêt et reprise](#persistence)
- [Dépannage](#troubleshooting)
- [Architecture et organisation du dépôt](#architecture)

<a id="why-amiral"></a>
## Pourquoi Amiral ?

Comment coordonner en toute sécurité plusieurs agents de programmation travaillant sur le même projet logiciel ? Lancer plusieurs agents ne détermine pas qui est responsable de chaque tâche, ce qui doit être terminé en premier, quels travaux peuvent se chevaucher sans risque, ni comment transformer des modifications indépendantes en un résultat unique ayant fait l’objet d’une revue.

Amiral fournit cette couche de coordination. Il décompose les demandes, modélise les dépendances, ordonnance le travail dans les limites de capacité, isole les modifications, les intègre de manière délibérée, impose les contrôles du Reviewer et de la QA, consigne les échecs et reprend les travaux interrompus. Le bénéfice provient d’un processus et de responsabilités explicites, et non du seul nombre d’agents.

<a id="how-it-works"></a>
## Fonctionnement

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
## Principaux éléments différenciateurs

### La planification est un artefact à part entière

`amiral plan "Add authentication"` valide et conserve un plan inspectable et réutilisable sous `plans/` ; cette commande ne l’implémente **pas**. Il est ainsi possible de procéder à une revue ou à une approbation humaine avant que `amiral run --plan <plan-id>` n’exécute le graphe enregistré.

### Exécution tenant compte des dépendances

Le parallélisme ne consiste pas à « lancer autant d’agents que possible ». Une tâche devient éligible à l’exécution uniquement lorsque ses dépendances sont terminées. Les tâches indépendantes peuvent s’exécuter simultanément lorsque cela ne présente aucun risque et respecte la capacité configurée des agents et du provider.

```text
DB-001 ─────► API-001 ─────► UI-002
                    │
                    └──────► TEST-001

UI-001 ────────────────────► UI-002
```

### Rôles spécialisés et livraison isolée

Les rôles fournis sont Lead, Planner, Frontend, Backend, Database, DevOps, Reviewer et QA. Le Planner planifie, mais n’implémente pas ; les agents d’implémentation travaillent sur les tâches qui leur sont attribuées ; le Reviewer évalue indépendamment le résultat intégré ; la QA le vérifie indépendamment.

Les agents d’implémentation utilisent des worktrees Git isolés. L’isolation par worktree n’est pas présentée comme une singularité ; sa valeur tient ici à sa place dans l’ensemble du cycle de vie :

```text
repository
├── main workspace
├── .amiral/worktrees/<workflow-id>/...
└── .amiral/integration/<workflow-id>/...

task execution → isolated worktrees → integration workspace → review → QA
```

### Contrôles indépendants de Review et de QA

La Review est un contrôle obligatoire, pas une suggestion. Ses statuts sont `PASS`, `CHANGES_REQUESTED` et `BLOCKED`. Les modifications demandées créent des tâches de correction et déclenchent une nouvelle revue, dans la limite de `quality.max_review_rounds` (un entier positif, `3` par défaut) ; Amiral ne prétend pas offrir des corrections autonomes illimitées.

Pour les workflows applicables et non triviaux, l’achèvement signifie que l’implémentation et l’intégration ont réussi, que la Review a renvoyé `PASS` et que la QA a renvoyé `PASS`. « L’agent a terminé de programmer » ne constitue pas la définition d’un travail achevé ; ce processus ne garantit rien au-delà des contrôles réellement effectués.

### Workflows persistants, résultats explicites et CLI adaptée à l’automatisation

L’état et l’historique du workflow sont conservés dans des fichiers JSON locaux. Une reprise poursuit l’état existant au lieu de recommencer la planification :

```bash
amiral status
amiral workflow history <workflow-id>
amiral run --workflow <workflow-id>
```

Les états des tâches sont `pending`, `in_progress`, `retry_wait`, `completed`, `failed`, `blocked` et `cancelled`. Les états des workflows sont `planned`, `running`, `blocked`, `failed`, `completed` et `cancelled`. Ces états persistants se distinguent des raisons d’arrêt de `run` : `completed`, `retry_scheduled`, `failed`, `blocked`, `needs_input`, `max_review_rounds`, `no_progress` et `interrupted`. Leur caractère explicite empêche qu’une automatisation en échec ou en pause apparaisse comme terminée.

La sortie JSON globale, les diagnostics, les contrôles de nouvelle tentative et d’historique ainsi que les catégories stables de codes de sortie facilitent l’utilisation de scripts, d’environnements CI et de futurs plans de contrôle, sans prétendre fournir une orchestration CI intégrée.

<a id="quick-start"></a>
## Démarrage rapide

```bash
npm install --global amiral-ai
cd my-project
git init # only when needed
amiral init
amiral doctor
amiral plan "Add authentication"
amiral run --plan <generated-plan-id>
```

Alternative en une seule étape :

```bash
amiral run "Add authentication"
```

`plan` = inspecter avant l’implémentation ; `run` = exécuter.

<a id="comparison"></a>
## Ce qui distingue Amiral

| Capacité | Agent de programmation unique | Lanceur d’agents parallèles | Framework multi-agent généraliste | Amiral |
| --- | --- | --- | --- | --- |
| Agents spécialisés | Limités | Généralement | Selon le framework | Rôles fournis |
| Worktrees Git isolés | Généralement non | Souvent | Personnalisé | Oui |
| Graphe de dépendances persistant et ordonnancement | Généralement non | Variable | À construire/configurer | Oui |
| Plan enregistré sans exécution | Variable | Variable | À construire/configurer | Oui |
| Workspace d’intégration contrôlé | Généralement non | Variable | Personnalisé | Oui |
| Contrôle indépendant Review → correction | Variable | Variable | Personnalisé | Oui |
| Contrôle indépendant de QA | Rare | Variable | Personnalisé | Oui |
| Workflow persistant pouvant être repris | Variable | Variable | Personnalisé | Oui |
| Nouvelles tentatives/historique et CLI lisible par machine | Limités | Variable | Selon le framework | Oui |

Les lanceurs parallèles répondent à la question de savoir comment exécuter des travaux simultanément ; Amiral détermine également qui en est responsable, ce qui doit être terminé en premier, comment les résultats sont intégrés, qui les examine et les teste, et ce qui se produit après un échec ou une interruption.

<a id="framework-positioning"></a>
## Positionnement par rapport aux frameworks

Les frameworks multi-agents généralistes fournissent les primitives nécessaires à des systèmes d’agents arbitraires et peuvent constituer la bonne abstraction pour construire une plateforme personnalisée. Amiral adopte une approche délibérément structurée autour de la livraison logicielle :

```text
Requirement → Engineering Plan → Task Dependencies → Specialist Implementation
→ Git Integration → Code Review → QA → Completed Change
```

<a id="philosophy"></a>
## Philosophie

Les plans doivent pouvoir être inspectés. Les dépendances doivent régir l’exécution. Les agents parallèles doivent être isolés. L’intégration doit être délibérée. L’agent qui écrit le code ne doit pas en être le seul juge. Les échecs doivent rester des échecs jusqu’à leur résolution, et les workflows interrompus doivent pouvoir être repris.

> Les agents d’IA doivent travailler comme une équipe d’ingénierie, et non comme un ensemble de terminaux sans rapport entre eux.

[↑ Retour en haut](#top)

<a id="installation"></a>

## La distinction la plus importante : `plan` n’exécute rien

> **`amiral plan` crée et valide un plan réutilisable, l’écrit sous `plans/`, affiche l’ID du plan, puis se termine. Cette commande ne crée ni n’exécute intentionnellement aucun workflow.**
>
> **`amiral run` exécute.** Lorsqu’une demande lui est fournie, cette commande commence par la planifier, puis crée et exécute un workflow. Elle peut également exécuter un plan enregistré ou reprendre un workflow persistant.

Choisissez la commande en fonction de votre intention :

| Vous souhaitez... | Utilisez |
| --- | --- |
| Inspecter ou approuver un graphe de tâches avant le début de toute implémentation | `amiral plan "Add authentication"` |
| Exécuter ce plan approuvé | `amiral run --plan feature-ab12cd34` |
| Planifier et exécuter avec une seule commande | `amiral run "Add authentication"` |
| Poursuivre un workflow interrompu, mis en pause ou en attente d’une nouvelle tentative | `amiral run --workflow feature-ab12cd34` |
| Poursuivre le workflow actuellement sélectionné | `amiral run` |

```bash
# Two-step, review-before-execution flow
amiral plan "Add authentication" --type feature
# Output includes: Plan created: feature-ab12cd34
amiral run --plan feature-ab12cd34

# One-step flow: the same request is planned and then executed
amiral run "Add authentication" --type feature
```

L’option `--plan` de `run` accepte soit un ID de plan sous `plans/`, soit un fichier de plan/graphe existant. N’utilisez pas `amiral run --plan ...` en espérant créer un plan ; cette commande en consomme un.

## Prérequis

- Node.js **20 ou version ultérieure** et npm.
- Git, avec le répertoire cible initialisé en tant que dépôt. `amiral init` n’exécute jamais `git init`.
- La CLI du provider configuré. La configuration fournie utilise l’exécutable `opencode` ; installez-le, authentifiez-le conformément aux instructions d’OpenCode et assurez-vous qu’il figure dans le `PATH`.
- Un arbre de travail propre avant l’intégration. Amiral préserve les modifications sans rapport de l’utilisateur et n’effectue aucune intégration dans un arbre contenant des modifications non validées.
- Un accès au provider, des modèles et des identifiants adaptés à votre configuration OpenCode. Ne placez aucun secret dans une configuration suivie par Git.

Après l’initialisation, confirmez que tout est prêt avec `amiral doctor` et `amiral config validate`.

## Installation et invocation

### Installation globale

```bash
npm install --global amiral-ai
amiral --version
amiral --help
```

### Installation locale au projet

```bash
npm install --save-dev amiral-ai
npx amiral --version
```

Vous pouvez également ajouter un script de package, par exemple `"amiral": "amiral"`, puis exécuter `npm run amiral -- status`.

### Exécution sans installation

```bash
npx --yes amiral-ai --version
npx --yes amiral-ai init --minimal
```

`npm run build` sert uniquement à développer ce dépôt ; cette commande n’est pas nécessaire après l’installation du package publié. Avec une installation locale, privilégiez `npx amiral` afin d’utiliser le binaire local au projet. Sans installation locale, `npx amiral-ai ...` identifie le package npm sans ambiguïté.

### Vérification du package et de la version

```bash
amiral --version                         # active global/PATH binary
npx amiral --version                     # local binary, when installed
npm view amiral-ai version               # current registry version
npm list amiral-ai                       # local installed version
npm list --global amiral-ai              # global installed version
```

La version du package est lue depuis son fichier `package.json` installé ; ce dépôt déclare actuellement la version **0.1.5**. Si une ancienne version est toujours signalée après une mise à niveau, déterminez quel exécutable est résolu (`where amiral` sous Windows, `which -a amiral` sous macOS/Linux), supprimez les installations globales/locales conflictuelles, ne videz le cache normal de npm que si npm signale une corruption, puis réinstallez. Évitez d’associer aveuglément un ancien binaire global à un package local plus récent.

```bash
npm update --save-dev amiral-ai           # update a local dependency within its range
npm install --global amiral-ai@latest     # replace the global package
npx --yes amiral-ai@latest --version      # explicitly use the latest registry release
```

La réinstallation de la CLI ne migre ni ne supprime l’état d’exécution du projet. Consultez les changements de la version avant d’utiliser une CLI plus récente avec des données `tasks/` existantes.

<a id="initialization"></a>
## Initialiser un projet

Exécutez l’initialisation à la racine prévue du projet :

```bash
git init                                  # only if this is not already a Git repository
amiral init --minimal
amiral doctor
amiral config validate
```

```text
amiral init [--minimal] [--force]
```

- `--minimal` : installe uniquement `team.yaml`, les définitions de workflow, les schémas et l’agent de planification machine ; les skills fournis ne sont ni lus, ni validés, ni installés.
- `--force` : remplace les fichiers de modèle existants. Utilisez cette option avec précaution ; sans elle, les fichiers existants sont conservés.

L’initialisation complète installe les modèles figurant sur liste blanche dans `team.yaml` et `.opencode/` (agents, workflows, contrats, orchestration, politiques, prompts, schémas et configuration OpenCode), puis copie l’arborescence `vendor/skills/**` du package vers le répertoire `vendor/skills/**` de la cible. L’initialisation ajoute également à `.gitignore` un bloc Amiral délimité par des marqueurs ; elle ne duplique pas ce bloc et ne remplace aucun contenu extérieur à celui-ci. Elle refuse les destinations de liens symboliques non sûres et n’installe jamais de manifestes de package, de dépendances ou d’état d’exécution.

<a id="configuration"></a>
## Détection de la racine du projet

À l’exception de `init`, les commandes peuvent être exécutées à la racine du projet ou dans n’importe quel répertoire imbriqué, y compris depuis des chemins contenant des espaces. Amiral remonte l’arborescence :

1. L’ancêtre le plus proche contenant `team.yaml` est retenu.
2. Si aucun `team.yaml` n’est trouvé, le premier ancêtre contenant `.amiral` ou `.opencode` sert de solution de repli.
3. Si aucun de ces éléments n’existe, la commande échoue et suggère d’exécuter `amiral init`.

Le processus s’exécute ensuite depuis la racine détectée. `doctor` constitue un cas particulier : cette commande peut diagnostiquer le répertoire courant même lorsqu’aucune racine Amiral n’est trouvée, et `doctor --fix` peut y créer les répertoires de support ou fichiers minimaux manquants.

## Demandes : `goal` positionnel ou `--request`

La demande originale complète de l’utilisateur constitue l’entrée faisant autorité pour la planification.

- Dans un usage ordinaire, utilisez le paramètre positionnel `[goal]` pour la demande complète.
- Lorsque le goal positionnel n’est qu’un titre court, placez toutes les exigences dans `--request`.
- Si les deux sont fournis, la valeur non vide de `--request` constitue la demande complète faisant autorité ; le goal court ne lui est pas concaténé.
- En l’absence de `--request`, `goal` devient la demande complète.
- `--plan-file` importe un plan et ne nécessite donc aucun des deux arguments textuels.

```bash
# Full request in the positional argument
amiral plan "Add password reset with expiring one-use tokens and integration tests"

# Short display-level idea plus the complete authoritative request
amiral run "Password reset" \
  --request "Add email-based password reset. Tokens expire after 15 minutes, are one-use, and must be covered by integration tests." \
  --type feature
```

La mise entre guillemets dépend du shell. Placez entre guillemets les demandes contenant des espaces ; pour les demandes longues, utilisez la syntaxe de continuation de votre shell ou une seule ligne. Évitez de placer des secrets dans les arguments de commande, car les shells et les outils de gestion des processus peuvent les enregistrer.

## Modèle de fonctionnement

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

Principes fondamentaux :

- Inspectez le dépôt existant avant de prendre des décisions architecturales ; respectez les conventions en place.
- Le Lead est la seule autorité d’orchestration. Le Planner analyse et décompose, mais n’implémente pas.
- Les spécialistes frontend, backend, database et DevOps implémentent uniquement les travaux qui leur sont attribués.
- Une tâche est éligible à l’exécution uniquement lorsque toutes ses dépendances sont terminées. Les tâches indépendantes ne peuvent s’exécuter simultanément que dans les limites de capacité configurées du provider et des agents, et lorsque cela ne présente aucun risque.
- Le travail est isolé dans des worktrees de tâche et fusionné de manière idempotente dans un worktree d’intégration.
- Le Reviewer et la QA sont des contrôles indépendants. Un workflow non trivial n’est terminé qu’après l’implémentation, l’intégration, une Review `PASS` et une QA `PASS`.
- Une Review `CHANGES_REQUESTED` crée des tâches de correction jusqu’à la limite `quality.max_review_rounds` ; les contrôles bloquants ou épuisés ne sont pas transformés en faux succès.
- Préservez les modifications sans rapport, évitez les opérations Git destructrices et n’exposez jamais d’identifiants.

Le fichier `team.yaml` fourni définit les agents, les capacités, le routage et la capacité des providers, les baux, les nouvelles tentatives, la conservation Git ainsi que les workflows `feature`, `bugfix` et `refactor`. L’ordonnanceur utilise les dépendances des tâches et les capacités requises ; le parallélisme effectif est limité par `execution.max_parallel_agents` et par la concurrence du provider (ces deux valeurs sont fixées à 1 par défaut dans la configuration fournie).

## Options globales et sortie

Ces options peuvent être placées avant ou après une sous-commande ; les formes `--json`/`--verbose` propres aux commandes sont également acceptées lorsqu’elles sont déclarées.

| Option | Signification |
| --- | --- |
| `-q, --quiet` | Supprime la sortie normale lorsque les commandes utilisent le moteur de rendu de sortie standard. `config path` et `config show` sans JSON écrivent actuellement directement dans stdout. |
| `-v, --verbose` | Inclut les événements de diagnostic/progression lorsqu’ils sont pris en charge. |
| `--json` | Émet un document JSON unique pour la sortie d’une commande réussie. |
| `-V, --version` | Affiche la version du package. |
| `-h, --help` | Affiche l’aide ; utilisez cette option après n’importe quelle commande ou sous-commande pour obtenir une aide ciblée. |

Pour l’automatisation, utilisez `--json` et vérifiez le code de sortie :

```bash
amiral --json status > status.json
amiral doctor --json > doctor.json
amiral config show --json > config.json       # secret-like keys are redacted
amiral workflow list --json
```

La sortie JSON normale est écrite dans stdout sous la forme d’un document unique. Les erreurs sont écrites dans stderr ; en mode JSON, elles ont la forme `{"error":{"message":"...","code":N}}`. La progression détaillée du provider est supprimée pendant les commandes de planification, d’exécution et de contrôle produisant du JSON afin que stdout reste analysable. Dans les automatisations sans TTY, les commandes interactives exigent toujours `--force` lorsqu’indiqué dans la documentation.

`doctor` constitue une exception en matière de diagnostic : cette commande se termine actuellement avec le code `0` après avoir effectué ses contrôles, même lorsque certains échouent. L’automatisation doit examiner le nombre JSON `failures` ou chaque valeur `checks[].state` ; son seul code de sortie ne doit pas être considéré comme un indicateur d’état de préparation.

Les codes de sortie constituent des catégories stables de la CLI :

| Code | Signification |
| ---: | --- |
| 0 | Succès ; également utilisé lorsque `run` se met en pause pour une nouvelle tentative transitoire programmée. |
| 1 | Échec général ou absence de progression. |
| 2 | Utilisation incorrecte ou confirmation refusée/obligatoire. |
| 3 | Configuration manquante/non valide. |
| 4 | Workflow bloqué, contrôle non réussi, conflit de verrouillage/d’administration ou saisie requise. |
| 5 | Échec du provider. |
| 6 | Échec de validation/du schéma. |
| 130 | Interruption. |

<a id="commands"></a>
## Référence des commandes

### `amiral plan`

```text
amiral plan [goal]
  --type <feature|bugfix|refactor>   default: feature
  --request <text>                   complete original request
  --name <name>                      prefix used in generated plan ID
  --plan-file <file-or-plan-id>      import and validate planner-format JSON
  --json
```

Exécute le provider de planification (sauf en cas d’importation), valide et analyse le graphe, enregistre les artefacts sous `plans/<plan-id>/`, indique le nombre de tâches, la profondeur, les groupes parallèles et les avertissements de conflit, puis **se termine sans implémentation**.

```bash
amiral plan "Repair duplicate invoice creation" --type bugfix --name invoice-race
amiral plan --plan-file ./approved-plan.json --type refactor --json
```

Le contenu importé avec `--plan-file` doit être au format JSON du Planner ; `plan` écrit un nouveau répertoire de plan normalisé. Pour exécuter directement un graphe déjà enregistré, utilisez `run --plan`.

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

Un seul mode d’exécution peut être sélectionné :

1. `[goal]`, `--request` ou `--plan-file` : crée un plan, crée un workflow, puis l’exécute.
2. `--plan <id-or-file>` : valide un résultat du Planner/graphe de tâches enregistré, crée un workflow, puis l’exécute.
3. `--workflow <id>` : reprend ce workflow persistant.
4. Aucun mode : reprend le workflow actif (ou l’unique workflow si aucun n’est sélectionné).

`--name` nomme les nouveaux ID de plan/workflow générés ; cette option ne renomme pas un workflow existant. `--type` détermine le type d’une nouvelle planification en ligne et sert de valeur de repli lorsqu’un graphe importé n’indique aucun type de workflow.

```bash
amiral run "Add favorites" --type feature
amiral run --plan feature-ab12cd34
amiral run --plan ./plans/reviewed/task-graph.json --name favorites-approved
amiral run --workflow feature-cd34ef56 --verbose
amiral run                              # active workflow
```

`run` conserve le verrou d’exécution et parcourt l’ordonnancement, la répartition vers les providers, l’intégration, les cycles de revue/correction et la QA. Cette commande rend la main lorsque le travail est terminé ou lorsqu’une condition de pause sûre est atteinte ; ce n’est pas un daemon.

### `amiral status`

```text
amiral status [--workflow <id>] [--json] [--verbose]
```

Affiche le statut du workflow, le nom du provider par défaut configuré, le nombre de tâches et les détails des nouvelles tentatives/erreurs de provider, l’état de qualité et les worktrees actifs. Cette commande ne contrôle pas en direct l’état de santé ni l’authentification du provider ; utilisez `doctor` pour les diagnostics. Sans `--workflow`, elle détermine le workflow actif ou unique.

```bash
amiral status
amiral status --workflow feature-cd34ef56 --json
```

### `amiral workflow`

Sous-commandes d’administration et d’inspection :

```text
amiral workflow list
amiral workflow use <id>
amiral workflow show <id> [--json]
amiral workflow cancel <id> [--force]
amiral workflow reset-task <task-id> [--workflow <id>] [--force]
amiral workflow history [id] [--limit <positive-integer>]   default: 20
```

- `list` : répertorie les ID, les statuts, la sélection active et les heures de mise à jour.
- `use` : enregistre la sélection du workflow actif utilisée par les commandes ne comportant aucun ID.
- `show` : affiche le goal/résumé du graphe lorsqu’il est disponible, ainsi que les détails des tâches.
- `cancel` : annule un workflow et libère les baux. Cette commande demande confirmation dans un TTY ; une utilisation non interactive exige `--force`.
- `reset-task` : replace manuellement une tâche dans un état permettant une nouvelle tentative. `--workflow` permet de lever toute ambiguïté ; `--force` autorise les cas de réinitialisation autrement restreints. Cette sous-commande ne demande aucune confirmation.
- `history` : affiche la vue d’historique la plus récente demandée, dans la limite de `--limit` ; omettez l’ID pour utiliser la résolution active.

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

Sélectionnez exactement un ID de tâche, `--failed` ou `--blocked`. Cette commande réinitialise les tâches correspondantes, mais conserve leurs worktrees ; elle ne les exécute pas. Exécutez ensuite `amiral run --workflow <id>` (ou `amiral run` pour le workflow actif).

```bash
amiral retry API-002 --workflow feature-cd34ef56
amiral retry --failed --workflow feature-cd34ef56
amiral run --workflow feature-cd34ef56
```

### `amiral review` et `amiral qa`

```text
amiral review [--workflow <id>] [--json]
amiral qa     [--workflow <id>] [--json]
```

Exécute un contrôle autonome sur le workflow/workspace d’intégration sélectionné. La Review indique le verdict, le résumé et les constats ; la QA indique le verdict, les contrôles et les constats. Un verdict autre que `PASS` entraîne une sortie avec le code 4. Ces commandes exécutent uniquement un contrôle ; elles ne remplacent pas le cycle de vie complet de `run` et n’exécutent pas automatiquement les corrections qui en résultent.

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

Le nettoyage est prudent :

- Sans sélecteur de politique de nettoyage, la commande se contente de prévisualiser le nettoyage des worktrees terminés ; aucun fichier n’est supprimé.
- `--dry-run` affiche toujours une prévisualisation.
- `--completed` active la suppression des worktrees terminés.
- `--remove-failed` / `--remove-blocked` autorisent explicitement la suppression des worktrees en échec/bloqués qui ont été conservés.
- `--delete-branches` autorise explicitement la suppression des branches ; sans cette option, elles sont conservées.
- Par défaut, la portée correspond au workflow actif ; choisissez soit un `--workflow`, soit `--all`, jamais les deux.
- Le nettoyage effectif demande confirmation dans un TTY et exige `--force` dans les environnements non interactifs.
- La prévisualisation actuelle indique l’utilisation globale des worktrees. La portée affichée est une métadonnée contextuelle, et non un plan de suppression exact pour chaque worktree filtré par `--workflow`.

```bash
amiral clean --workflow feature-cd34ef56 --dry-run
amiral clean --workflow feature-cd34ef56 --completed
amiral clean --all --completed --remove-failed --delete-branches --force
```

### `amiral doctor`

```text
amiral doctor [--json] [--fix]
```

Contrôle l’organisation du projet, l’état de santé de Git, du provider et de la configuration, les répertoires d’exécution et les worktrees obsolètes. `--fix` effectue des réparations de support limitées : cette option garantit l’existence de `.amiral/worktrees`, `.amiral/integration` et `tasks`, exécute une initialisation minimale et garantit la présence du bloc `.gitignore` géré par des marqueurs. Ce n’est pas un outil général de réparation automatique ; il n’initialise pas Git et n’authentifie aucun provider.

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

- `path` : affiche le chemin absolu du fichier `team.yaml` détecté.
- `show` : affiche la configuration normalisée, la capacité effective d’exécution/des providers et les providers enregistrés. Les clés correspondant à token/key/secret/password sont remplacées récursivement par `[REDACTED]`.
- `validate` : vérifie que le provider par défaut est enregistré/activé et que la configuration contient au moins une définition d’agent sous forme d’objet ; la sortie inclut les données relatives au provider/à la capacité. Cette commande ne valide pas en profondeur chaque champ d’agent ni le fichier d’agent correspondant.

```bash
amiral config path
amiral config show --json
amiral config validate
```

Le masquage constitue une protection d’affichage, et non une autorisation de stocker des secrets dans `team.yaml`.

<a id="persistence"></a>
## Persistance, arrêt et reprise

Les plans et les workflows sont des objets persistants distincts :

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

Ces chemins correspondent à des artefacts d’exécution locaux et l’outil d’initialisation les ajoute à `.gitignore`. Aucun stockage d’état SQLite n’est documenté : les fichiers JSON font autorité. Ne modifiez pas l’état manuellement pendant qu’une commande détient le verrou `.amiral/amiral.lock`.

La résolution du workflow sans `--workflow` utilise `tasks/.active-workflow` ; en son absence, un workflow unique est automatiquement sélectionné, tandis que plusieurs workflows exigent `amiral workflow use <id>` ou un ID explicite.

`run` s’arrête en toute sécurité pour les raisons suivantes :

- `completed` : tous les travaux d’implémentation/de correction ont été intégrés, la revue a réussi et la QA a réussi.
- `retry_scheduled` : une nouvelle tentative transitoire du provider est en attente ; le code de sortie est 0 et `nextRetryAt` est fourni lorsqu’il est connu. Relancez la commande après cette heure.
- `failed` : échec de tâche ne pouvant pas faire l’objet d’une nouvelle tentative ou nouvelles tentatives épuisées ; examinez l’état/les résultats, réinitialisez avec `retry`, puis relancez la commande.
- `blocked` : blocage du workflow/de la tâche ; examinez le statut/l’historique, puis résolvez le problème ou effectuez une réinitialisation manuelle selon le cas.
- `needs_input` : workflow annulé, contrôle bloqué/en échec, épuisement des corrections demandées par la revue ou limite de sécurité de 25 itérations. Le message relatif à cette limite autorise explicitement une nouvelle exécution.
- `max_review_rounds` : les modifications demandées par la revue n’ont pas pu progresser dans le nombre de cycles configuré ; le workflow est bloqué.
- `no_progress` : aucune tâche éligible à l’exécution et aucune nouvelle tentative en attente ; examinez les dépendances et l’historique.
- `interrupted` : le premier signal `SIGINT`/`SIGTERM` demande un arrêt sûr avant la prochaine mutation et entraîne une sortie avec le code 130. Un deuxième signal met immédiatement fin au processus ; ne l’utilisez donc qu’en cas de nécessité.

La reprise ne relance pas la planification :

```bash
amiral status --workflow feature-cd34ef56
amiral workflow history feature-cd34ef56 --limit 50
amiral run --workflow feature-cd34ef56
```

Les commandes qui modifient l’état d’exécution partagé utilisent un verrou de projet. Si un autre processus le détient, attendez qu’il se termine ou diagnostiquez un propriétaire réellement obsolète ; ne supprimez jamais aveuglément un verrou actif.

<a id="troubleshooting"></a>
## Dépannage

### « Aucun projet Amiral trouvé »

Exécutez la commande depuis l’arborescence prévue, vérifiez qu’un ancêtre contient `team.yaml` ou initialisez le projet. `amiral config path` confirme la détection.

### Échec de l’exécutable/de l’authentification du provider

Exécutez `amiral doctor --verbose` et `amiral config show` ; vérifiez `providers.<name>.binary`, `enabled`, la résolution du PATH et la connexion au provider en dehors d’Amiral. Les erreurs de provider peuvent faire l’objet de nouvelles tentatives conformément à `team.yaml` ; les diagnostics sont conservés pour les échecs de planification.

### Plusieurs workflows et aucun workflow actif

```bash
amiral workflow list
amiral workflow use <workflow-id>
```

Vous pouvez également transmettre explicitement `--workflow`.

### Arbre contenant des modifications non validées ou conflit de fusion

Validez ou mettez de côté uniquement les modifications que vous aviez l’intention d’apporter, préservez les travaux sans rapport, inspectez les worktrees de tâche/d’intégration et réessayez après avoir résolu le problème Git sous-jacent. N’utilisez pas habituellement des réinitialisations destructrices comme solution.

### Une exécution a réussi, mais n’est pas terminée

Vérifiez la valeur JSON/texte de `reason`. `retry_scheduled` renvoie intentionnellement 0 même si l’exécution est en pause. Attendez jusqu’à `nextRetryAt`, puis reprenez. Seule la valeur `reason: "completed"` signifie que tous les contrôles ont réussi.

### Une tâche a échoué ou est bloquée

```bash
amiral status --workflow <id> --json
amiral workflow history <id> --limit 100
amiral workflow show <id> --json
amiral retry <task-id> --workflow <id>
amiral run --workflow <id>
```

N’utilisez `--force` qu’après avoir compris pourquoi une réinitialisation/annulation/un nettoyage est restreint.

### Échec de l’analyse JSON

Placez `--json` sur la commande, analysez uniquement stdout et conservez stderr séparément. Ne fusionnez pas les flux (`2>&1`) lorsque vous consommez du JSON. Les invites nécessitant une confirmation exigent `--force` dans la CI.

<a id="architecture"></a>
## Architecture et organisation du dépôt

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

Les workflows actifs fournis avec le package sont `feature`, `bugfix` et `refactor`. Les agents comprennent Lead, Planner, Frontend, Backend, Database, DevOps, Reviewer et QA. Les définitions des agents décrivent les responsabilités ; les workflows décrivent le processus ; les politiques imposent des règles transversales ; les contrats définissent des transferts lisibles par machine ; les skills apportent des connaissances spécialisées uniquement lorsqu’elles sont pertinentes.

## Développement depuis les sources

Clonez ce dépôt et installez les dépendances verrouillées :

```bash
git clone https://github.com/atahandevelopment/amiral-ai.git
cd amiral-ai
npm ci
npm run typecheck
npm test
npm run build
node dist/src/cli/index.js --help
```

Scripts utiles :

| Script | Objectif |
| --- | --- |
| `npm run typecheck` | Vérifie les types sans produire le build distribuable. |
| `npm test` | Exécute la suite de tests Node avec `tsx`. |
| `npm run build` | Compile avec `tsconfig.build.json` dans `dist/`. |
| `npm run validate:team -- <task-graph|agent-result|review-result|planner-result> <file>` | Valide un artefact de contrat JSON par rapport au schéma sélectionné. |
| `npm pack --dry-run` | Inspecte le contenu à publier ; `prepack` nettoie et reconstruit `dist`. |

Pour tester la CLI depuis l’arborescence des sources, commencez par effectuer le build, puis invoquez `node dist/src/cli/index.js ...` ; le binaire `amiral` publié pointe vers ce point d’entrée compilé. Les anciens points d’entrée `scripts/*.ts` restent des outils de compatibilité/internes, mais l’utilisation du produit doit privilégier la CLI.

## Licence

Ce package déclare la licence ISC dans `package.json`.
