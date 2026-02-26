# Pegn-AI: The AI-Native Work OS (Phase 1 POC)

![Pegn-AI Banner](https://img.shields.io/badge/Status-Phase_1_POC-blueviolet?style=for-the-badge)
![Tech Stack](https://img.shields.io/badge/Stack-React_|_Node_|_Postgres_|_Gemini-blue?style=for-the-badge)

**Pegn-AI** is an AI-first collaborative workspace designed to bridge the gap between human creativity and autonomous agentic workflows. It combines a powerful block-based editor with deep knowledge retrieval and multi-agent orchestration.

---

## 🌟 Core Pillars

### 1. Collaborative Block Intelligence
*   **Editor Experience**: Built on **BlockSuite**, providing a Notion-like editing experience with text, headings, code blocks, and more.
*   **Real-time Sync**: Powered by **Yjs** (CRDT) and **Hocuspocus**, ensuring sub-500ms convergence for world-wide collaboration.
*   **Persistence**: Automated 60-second snapshot system to prevent data loss and support version rollback.

### 2. Hybrid Knowledge Retrieval
*   **Hybrid Search**: A dual-engine approach combining **BM25 full-text search** with **PostgreSQL pgvector** similarity search.
*   **GraphRAG Integration**: Leverages knowledge graph entities and relationships to provide context-aware AI responses.
*   **Real-time Indexing**: Automatic indexing of document blocks as you type.

### 3. Agentic Workflows
*   **Autonomous Agents**: Ready-to-use templates for **Research** and **Summarization**.
*   **SSE Progress Tracking**: Real-time feedback for multi-step agent execution via Server-Sent Events.
*   **Supervisor Pattern**: Foundation for multi-agent coordination and recursive task decomposition.

### 4. Enterprise-Ready Observability
*   **Performance Tracking**: Full HTTP lifecycle monitoring.
*   **Health Dashboard**: Real-time system status including DB connectivity and CRDT health.
*   **Metrics**: Prometheus-ready metrics export for production scalability.

---

## 🛠️ Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React 19, Vite, Framer Motion, Tailwind CSS, Lucide Icons |
| **Editor** | BlockSuite, Yjs, Hocuspocus (Sync) |
| **Backend** | Node.js (Express), TypeScript, tsx |
| **Database** | PostgreSQL + pgvector extension, Redis (Caching) |
| **AI/ML** | Google Gemini (2.0/2.5 Flash), Vector Embeddings |
| **Tests** | Vitest, React Testing Library |

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: 18.0 or higher
- **Docker**: For PostgreSQL and Redis services
- **Gemini API Key**: Required for AI features

### Quick Start
1. **Clone and Install**
   ```bash
   git clone https://github.com/liboyin9087-jpg/Pegn-AI.git
   cd Pegn-AI
   npm install
   ```

2. **Environment Setup**
   ```bash
   cp apps/server/.env.example apps/server/.env
   # Add your GEMINI_API_KEY to apps/server/.env
   ```

3. **Spin up Infrastructure**
   ```bash
   docker compose up -d
   ```

4. **Database Migrations**
   ```bash
   cd apps/server
   npm run db:migrate # Applies RBAC and Search Schema
   ```

5. **Run Development Mode**
   ```bash
   # From root
   npm run dev
   ```

### Service Map
- **Frontend App**: [http://localhost:5177](http://localhost:5177)
- **API Server**: [http://localhost:4000](http://localhost:4000)
- **Sync Server**: `ws://localhost:1234`
- **Metrics**: `http://localhost:4000/metrics`

---

## 📂 Project Structure

```text
pegn-ai/
├── apps/
│   ├── server/           # Express Server + Hocuspocus + Agent Services
│   │   ├── src/db/       # Migrations & pgvector schema
│   │   └── src/routes/   # AI, Search, and GraphRAG endpoints
│   └── web/              # React + BlockSuite Frontend
│       ├── src/components/agent-dashboard/   # Advanced AI UI
│       └── src/components/database/          # Collection views
├── docker-compose.yml    # Postgres (pgvector) + Redis
└── LOCAL_RUN.md          # Troubleshooting & advanced setup
```

---

## 🗺️ Roadmap (Phase 2)
- [ ] **Multi-Agent Orchestration**: Recursive task breakdown with Supervisor-Worker pattern.
- [ ] **Billing & Quotas**: Integration with Stripe and Token usage tracking.
- [ ] **Advanced KG Visualization**: Interactive Knowledge Graph explorer.
- [ ] **Offline-first Mobile**: Progressive Web App (PWA) support.

---

## 📄 License
This project is licensed under the MIT License - see the LICENSE file for details.

---
*Developed by Pegn AI Team - 2026*
