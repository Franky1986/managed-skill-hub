<p align="center">
  <img alt="Managed Skill Hub Logo" src="./apps/web/public/managedSkillHubLogo.png" width="128" />
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README_de.md">Deutsch</a>
</p>

<p align="center">
  <img alt="Managed Skill Hub" src="https://img.shields.io/badge/Managed%20Skill%20Hub-0.1.0-6f42c1">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.7.3-3178C6?logo=typescript&logoColor=white">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black">
  <img alt="Fastify" src="https://img.shields.io/badge/Fastify-4.x-000000?logo=fastify">
  <img alt="License" src="https://img.shields.io/badge/License-Apache%202.0-D22128">
  <a href="https://www.linkedin.com/in/frank-richter-24657078/">
    <img alt="Erstellt von Frank Richter" src="https://img.shields.io/badge/Created%20by-Frank%20Richter-0A66C2?logo=linkedin&logoColor=white">
  </a>
</p>

# ManagedSkillHub Skill Registry

Governed Skill Registry für KI-Agenten.

## Zweck

ManagedSkillHub macht wiederverwendbare Agent-Anleitungen zu geprüften,
versionierten und auffindbaren Assets. Produktmanager, Entwickler und Reviewer
können Skills pflegen, prüfen, freigeben, versionieren und veröffentlichen;
Coding Agents wie Codex, Claude, OpenCode, Gemini, Cursor und Windsurf können
nur veröffentlichte Skills über eine stabile Public API entdecken und nutzen.

Das Ziel ist, Skill-Wiederverwendung aus Chat-Historien, lokalen Ordnern und
Copy/Paste-Prozessen in eine auditierbare Registry zu überführen: mit klarer
Ownership, Review-Status, unveränderlichen veröffentlichten Versionen und
maschinenlesbaren Contracts.

## Warum Das Wertvoll Ist

- Agents können sich über `GET /discover`, `GET /howToPropose`,
  `GET /openapi.yaml` und die Published-Skill-APIs selbst bootstrappen, ohne UI
  oder projektspezifischen Client.
- Veröffentlichte Skills können als deterministische Versionspakete geladen
  werden; lokale Agents müssen Dateien nicht aus Prosatext rekonstruieren.
- Jeder kann ohne Admin-Zugang ein Proposal einreichen; Admins können reviewen,
  Proposals in Drafts konvertieren, freigeben, veröffentlichen oder ablehnen.
- Optionale LLM-Judger können Proposals und Dateien vor der Veröffentlichung
  bewerten. Mit `AUTO_PUBLISH_ON_GREEN=true` können risikoarme Proposals nach
  grünen Judgements automatisch veröffentlicht werden; `noop` Judgements
  gelten dabei als nicht bewertet, sofern das nicht explizit überschrieben ist.
- Agents sollen vor dem Upload intelligente Dublettenchecks ausführen,
  Metadaten und Datei-Fingerprints vergleichen, ähnliche Skills oder Proposals
  anzeigen und den Nutzer vor wahrscheinlichen Dubletten bestätigen lassen.
- Betreiber können lokal mit SQLite starten, MySQL für Catalog- und
  Search-Projektionen nutzen oder später weitere Provider hinter denselben
  Ports ergänzen.

## Workflow Im Überblick

1. Agents suchen und laden veröffentlichte Skills über Public-Read-Endpunkte.
2. Agents bauen ein normalisiertes Proposal-Paket, validieren Referenzen,
   scannen auf Secrets/PII und führen Dublettenchecks aus.
3. Agents reichen Proposals ohne Admin-Zugang ein, hängen Dateien an und pollen
   die öffentliche Status-URL.
4. Ein Admin kann reviewen, Metadaten bearbeiten, Drafts anlegen, freigeben,
   veröffentlichen oder ablehnen. Alternativ kann konfiguriertes Auto-Publish
   grün bewertete, eligible Proposals nach realen Judgements veröffentlichen.
5. Veröffentlichte Versionen sind sofort über die Public API und den
   deterministischen Package-Download verfügbar.

## Status

Das Greenfield-MVP und die Stärkung des Agent-Workbench in EPIC-002 sind implementiert.
Die nächste Produktentwicklung ist in
[`EPIC-003`](./docs/roadmap/EPIC-003-english-first-localization-and-agent-contracts.md) dokumentiert:
English-first Dokumentation und agent-orientierte Verträge mit zweisprachiger Web-UI.

## Wichtige Dokumente

1. [`AGENTS.md`](./AGENTS.md) - Regeln für Coding Agents
2. [`docs/setup/BUILD_AND_CHECKS.md`](./docs/setup/BUILD_AND_CHECKS.md) - Build,
   Checks und lokaler Start
3. [`docs/setup/TESTING.md`](./docs/setup/TESTING.md) - lokale API- und UI-Tests
4. [`docs/setup/ENVIRONMENT.md`](./docs/setup/ENVIRONMENT.md) - Root-`.env`,
   SQLite/MySQL-Provider, Judger-Einstellungen und Auto-Publish-Flags
5. [`docs/setup/JUDGER_ADAPTERS.md`](./docs/setup/JUDGER_ADAPTERS.md) - OpenAI/Vercel AI SDK oder Custom-Judger-Adapter ergänzen
6. [`docs/product/AGENT_OPERATIONS.md`](./docs/product/AGENT_OPERATIONS.md) -
   lokale Agent-Runbooks für SQLite, MySQL, Judger und Auto-Publish
7. [`docs/setup/DEPLOYMENT.md`](./docs/setup/DEPLOYMENT.md) - Server-Installation und Runtime-Layout
8. [`docs/roadmap/MASTER_PLAN.md`](./docs/roadmap/MASTER_PLAN.md) - Vision, Umfang und Phasen
9. [`docs/roadmap/EPIC-003-english-first-localization-and-agent-contracts.md`](./docs/roadmap/EPIC-003-english-first-localization-and-agent-contracts.md)
   - englisch-zentrierte Lokalisation und agent-orientierte Verträge
10. [`docs/progress/NEXT_STEPS.md`](./docs/progress/NEXT_STEPS.md) - aktuelle nächsten Schritte
11. [`docs/decisions/`](./docs/decisions/) - Architekturentscheidungen (ADRs)
12. [`docs/index.md`](./docs/index.md) - Dokumentationsindex

## Schnellstart

```bash
cd /pfad/zu/managed-skill-hub

# 1. Abhängigkeiten installieren
npm ci --legacy-peer-deps

# 2. Checks ausführen
./scripts/check.sh

# 3. Lokale Konfiguration erstellen
cp .env.example .env

# Lokale Defaults:
# ADMIN_PASSWORD=admin
# Optionaler BCrypt-Hash:
# node -e "console.log(require('bcryptjs').hashSync('admin', 10))"

# 4. Entwicklungsserver starten
# Variante A: einzelner Befehl im Repo-Wurzelverzeichnis
npm run dev

# Variante B: manuell starten
# Terminal 1:
npm --workspace=apps/api run dev

# Terminal 2:
npm --workspace=apps/web run dev
```

- Frontend: http://localhost:3041
- API: http://localhost:3040
- Admin-Login: http://localhost:3041/admin/login

## Automatisierter Smoke Test

```bash
bash scripts/smoke-test.sh
```

Das Skript startet das Backend, prüft Health, öffentliche Lese-Endpunkte, Admin-Login,
Skill-Anlage und den Proposal-Workflow und stoppt anschließend das Backend wieder.
Details in [`docs/setup/TESTING.md`](./docs/setup/TESTING.md).

## Produktions-Build und Start

```bash
npm run build:prod
node apps/api/dist/server.js
```

## Provider- und Judger-Setup

- SQLite ist der lokale Default (`CATALOG_PROVIDER=sqlite`,
  `SEARCH_PROVIDER=sqlite`).
- MySQL wird über `CATALOG_PROVIDER=mysql`, `SEARCH_PROVIDER=mysql` und
  `MYSQL_*` konfiguriert; siehe [`docs/product/AGENT_OPERATIONS.md`](./docs/product/AGENT_OPERATIONS.md).
- `JUDGER_PROVIDER=noop` ist der sichere Default und blockiert Auto-Publish,
  solange es nicht explizit überschrieben wird.
- `JUDGER_PROVIDER=vercel-ai-sdk` aktiviert den eingebauten Vercel-AI-SDK-Adapter;
  OpenAI-basierte Modelle benötigen `OPENAI_API_KEY`.
- Custom-Judger nutzen einen beliebigen nicht eingebauten `JUDGER_PROVIDER`
  plus `JUDGER_ADAPTER_PATH`; siehe [`docs/setup/JUDGER_ADAPTERS.md`](./docs/setup/JUDGER_ADAPTERS.md).

## Validierung

```bash
./scripts/check.sh
```

Dabei werden ausgeführt:

- Struktur- und Dokumentationschecks
- `npm run lint`
- `npm run typecheck`
- `npm run test`

## Stack

- **Backend:** TypeScript, Fastify, Hexagonal Architecture, Domain-Driven Design
- **Frontend:** React, TypeScript, Vite
- **API:** OpenAPI-first, öffentlicher Lesezugriff ohne Auth, geschützter Admin-Pfad
- **Persistenz:** dateibasierte Artefakte in `data/`, SQLite-FTS5-Index, SQLite-Metadatenprojektion
- **Suche:** Keyword/BM25, Volltext, Regex
- **Auth:** einfache Admin-Authentifizierung via `.env` für das MVP; Authentik/OIDC später
- **Judger:** Noop-Standard mit optionalem Vercel-AI-SDK-Provider. Custom-Judger
  können über `JUDGER_ADAPTER_PATH` geladen werden.
- **Deployment:** `/path/to/deploy-root/src` ist austauschbar, `/path/to/deploy-root/data` ist persistent

## Repository-Struktur

```text
apps/
  api/        Fastify Backend
  web/        React Frontend
packages/
  openapi/    OpenAPI-Spezifikation und generierte Typen
  shared/     technische gemeinsame Typen
data/
  skills/     veröffentlichte Skill-Artefakte
  proposals/  eingereichte Vorschläge
  index/      SQLite-FTS5 Suchindex und Metadatenprojektion
  audit/      JSONL Audit-Logs
  backups/    Backup-Archive
docs/         Dokumentation, ADRs, Specs
scripts/      Build-, Deploy-, Backup- und Test-Skripte
```

## MVP-Grenzen

- Kein produktionsreifer Deployment-Flow ist enthalten.
- Keine Authentik-Integration.
- Kein gehosteter externer Judger-Service ist enthalten; Betreiber konfigurieren
  den Vercel-AI-SDK-Provider oder stellen einen eigenen Adapter bereit.
- Eigene Judger-Adapter laufen hinter dem providerneutralen `SkillJudgerPort`.
- Kein MCP Server.
- Keine automatischen Backups.

## Agent Bootstrap

Agents sollen mit der öffentlichen API starten:

```bash
curl http://localhost:3040/discover
curl http://localhost:3040/howToPropose
curl http://localhost:3040/openapi.yaml
```

Agent-orientierte API-Hinweise sind auf Englisch.
Agents sollten mit dem Nutzer in der Sprache des Nutzers kommunizieren, sofern der Nutzer sie nicht explizit wechselt.

Der veraltete TypeScript-Referenz-Client unter `agents/registry-bootstrap/` wird nur zu Referenzzwecken gehalten.
Empfohlener Integrationspfad ist die direkte API-Nutzung über `GET /discover` und `GET /openapi.yaml`.
