# Polaris Intelligence Engine — Architecture Documentation

**Version:** 2.0  
**Last Updated:** 2026-07-14  
**Status:** Production-ready foundation

---

## 1. Architecture Overview

Polaris is a dedicated backend application service — not a dashboard component, not a calendar widget, not page-specific logic. Every page in NorthStar communicates with Polaris through a centralized API.

```
┌─────────────────────────────────────────────────────┐
│                   Application Pages                  │
│  Dashboard  Calendar  Leads  Comms  Customers  ...  │
└──────────┬──────────┬───────┬───────┬──────────────┘
           │          │       │       │
           ▼          ▼       ▼       ▼
┌─────────────────────────────────────────────────────┐
│              Polaris API Routes                     │
│           /api/v1/polaris/*                         │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              Polaris Engine (src/polaris/)           │
│                                                      │
│  ┌──────────┐  ┌───────────┐  ┌────────────────┐    │
│  │Estimation│  │ Learning  │  │Recommendations  │    │
│  │Framework │  │ Pipeline  │  │Engine           │    │
│  └────┬─────┘  └─────┬─────┘  └───────┬────────┘    │
│       │              │                │              │
│       └──────────────┼────────────────┘              │
│                      ▼                               │
│  ┌──────────────────────────────────────────────┐    │
│  │              Polaris Store                    │    │
│  │  (File-backed, PostgreSQL-ready data layer)   │    │
│  └──────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              Future AI Interfaces                    │
│  ChatGPT ────► Polaris ◄──── Retell AI              │
│  (queries    (source of    (voice scheduling)       │
│   intelligence)  truth)                             │
└─────────────────────────────────────────────────────┘
```

### Core Design Principles

| Principle | Description |
|-----------|-------------|
| **Single source of truth** | All pages consume Polaris through the same API. No duplicated logic. |
| **Self-learning** | Every completed job trains future predictions. The system improves over time. |
| **Company-specific** | Learning is per-business. Company A's 2-hour water heater installs don't get averaged with Company B's 3.5-hour ones. |
| **Pluggable storage** | Currently file-backed (JSON). PostgreSQL-ready schemas are defined. Swap storage by implementing the same interface. |
| **AI-ready** | ChatGPT and Retell AI interfaces are prepared. They query Polaris as the source of truth. |

---

## 2. File Structure

```
src/
├── polaris/
│   ├── engine.js              # Core engine — entry point for all operations
│   ├── store.js               # Persistent storage layer
│   ├── data-model.js          # Production schema definitions (PostgreSQL DDL included)
│   ├── estimation.js          # Multi-variable estimation framework
│   ├── learning.js            # Self-learning pipeline
│   └── recommendations.js     # Recommendation engine
├── routes/
│   └── polaris.js             # API routes (prefixed /api/v1/polaris)
├── server.js                  # Server startup (wires Polaris init + routes)
data/
├── polaris-jobs.json          # Completed jobs (learning data)
├── polaris-estimates.json     # Historical estimates
├── polaris-metrics.json       # Learning metrics
├── polaris-crews.json         # Crew definitions (future)
└── polaris-recommendations.json # Generated recommendations
```

---

## 3. Data Model

### 3.1 Completed Job

The core unit of Polaris learning. Every finished appointment creates one.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Unique identifier |
| leadId | UUID | Source lead |
| customerId | UUID | Customer profile |
| customerName | VARCHAR(255) | Customer name |
| serviceType | VARCHAR(100) | e.g. HVAC Repair, Plumbing |
| jobCategory | VARCHAR(100) | Residential, Commercial, Emergency |
| leadSource | VARCHAR(50) | Phone Call, Website, Referral |
| appointmentDate | DATE | Scheduled date |
| scheduledStartTime | TIME | Scheduled start |
| scheduledEndTime | TIME | Scheduled end |
| estimatedDuration | DECIMAL(5,2) | Estimated hours |
| actualStartTime | TIME | Actual start |
| actualEndTime | TIME | Actual end |
| actualDuration | DECIMAL(5,2) | Actual hours |
| durationVariance | DECIMAL(5,2) | actualDuration - estimatedDuration |
| crewId | VARCHAR(50) | Assigned crew |
| crewSize | INTEGER | Number of crew members |
| technicianId | VARCHAR(50) | Primary technician |
| equipmentUsed | JSONB | Equipment used |
| vehicleId | VARCHAR(50) | Assigned vehicle |
| estimatedRevenue | DECIMAL(10,2) | Estimated revenue |
| actualRevenue | DECIMAL(10,2) | Actual revenue |
| materialsCost | DECIMAL(10,2) | Materials cost |
| laborCost | DECIMAL(10,2) | Labor cost |
| totalCost | DECIMAL(10,2) | Total cost |
| profitMargin | DECIMAL(5,2) | Profit margin % |
| travelDistance | DECIMAL(8,2) | Miles traveled |
| travelTime | DECIMAL(5,2) | Travel time in hours |
| weather | JSONB | Weather conditions |
| notes | TEXT | Job notes |
| completionStatus | VARCHAR(50) | completed, partial, cancelled, rescheduled |

### 3.2 Estimate

Historical estimates with variance tracking.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Unique identifier |
| leadId | UUID | Source lead |
| serviceType | VARCHAR(100) | Service estimated |
| difficulty | VARCHAR(20) | low, medium, high |
| region | VARCHAR(50) | Regional pricing tier |
| estimatedHours | DECIMAL(5,2) | Hours estimated |
| hourlyRate | DECIMAL(8,2) | Rate used |
| totalEstimated | DECIMAL(10,2) | Estimated total |
| confidence | INTEGER | 0-100 confidence score |
| variables | JSONB | All variables used |
| actualTotal | DECIMAL(10,2) | Set when job completes |
| variance | DECIMAL(10,2) | actualTotal - totalEstimated |

### 3.3 Learning Metrics

Tracked over time per service type.

| Field | Type | Description |
|-------|------|-------------|
| metricType | VARCHAR(50) | duration_accuracy, revenue_accuracy, crew_efficiency |
| serviceType | VARCHAR(100) | Specific service or null for aggregate |
| sampleSize | INTEGER | Number of data points |
| meanVariance | DECIMAL(10,4) | Average prediction error |
| meanAbsoluteError | DECIMAL(10,4) | Average absolute error |
| accuracyPct | DECIMAL(5,2) | Accuracy percentage |

### 3.4 Crew (Future)

| Field | Type | Description |
|-------|------|-------------|
| name | VARCHAR(100) | Crew name |
| size | INTEGER | Number of members |
| skills | JSONB | Service types this crew handles |
| equipment | JSONB | Equipment assigned |
| vehicleId | VARCHAR(50) | Assigned vehicle |
| status | VARCHAR(20) | active, inactive |
| efficiency | DECIMAL(5,2) | Average duration variance |

### 3.5 Recommendation

| Field | Type | Description |
|-------|------|-------------|
| type | VARCHAR(50) | follow_up, move_appointment, revenue_opportunity, capacity_warning, pipeline_bottleneck, scheduling_conflict, lost_opportunity, schedule_optimization |
| priority | VARCHAR(20) | high, medium, low |
| title | VARCHAR(255) | Human-readable title |
| description | TEXT | Detailed description |
| actionUrl | VARCHAR(500) | Link to take action |
| sourceData | JSONB | Data that generated this |
| resolved | BOOLEAN | Whether acted upon |

---

## 4. Estimation Framework

The estimation engine uses weighted inputs:

| Variable | Weight | Source |
|----------|--------|--------|
| Service type | Base | Explicit input |
| Job complexity | ±35% | Description length, property size, equipment count, crew size, stories |
| Property size | ±50% | Square footage tier (small/medium/large/xlarge) |
| Seasonality | ±30% | Month of year (peak summer = 1.3x, winter = 0.8x) |
| Travel distance | $1.50/mi | Distance to job site |
| Historical learning | ±varies | Rolling average of duration variance for same service type |

### Estimation Flow

```
Input: { serviceType, description, squareFootage, crewSize, travelDistance, ... }
   │
   ▼
1. Assess complexity (description length, property size, equipment, crew size)
   → low | medium | high
   │
   ▼
2. Look up base hours + hourly rate for service type
   │
   ▼
3. Apply complexity multiplier (1.0x, 1.15x, or 1.35x)
   │
   ▼
4. Apply property size multiplier (0.85x, 1.0x, 1.2x, or 1.5x)
   │
   ▼
5. Apply seasonality multiplier (0.8x - 1.3x based on month)
   │
   ▼
6. Calculate labor, materials, equipment, travel, overhead, profit, tax
   │
   ▼
7. Calculate confidence score based on data points available
   │
   ▼
8. Persist to historical estimates store
   │
   ▼
Output: { lineItems, total, confidence, reasoning, variables }
```

---

## 5. Self-Learning Pipeline

Every completed job feeds back into the system:

```
Job Completed
    │
    ▼
1. Record completion
   - Store estimatedDuration, actualDuration
   - Store estimatedRevenue, actualRevenue
   - Compute durationVariance, revenueVariance
   - Compute accuracy percentages
    │
    ▼
2. Update learning metrics
   - Per-service-type rolling averages
   - duration_accuracy: mean variance, mean absolute error, accuracy %
   - revenue_accuracy: mean variance, accuracy %
   - crew_efficiency: rolling average by crewId
    │
    ▼
3. Future estimates are adjusted
   - applyLearningToEstimate() adjusts estimated hours
   - Uses historical variance for the same service type
   - Example: HVAC Repair historically runs 0.4hr over → add 0.4hr to future estimates
    │
    ▼
4. Predictions become more accurate over time
```

### Variance Tracking

```
Estimated: 5.2 hours
Actual:    4.8 hours
Variance:  -0.4 hours (completed faster than estimated)
Accuracy:  92.3%

→ Next HVAC Repair estimate: reduce estimated hours by 0.4hr
```

---

## 6. Recommendation Engine

Recommendations are generated by scanning all data. Each has a type, priority, and action URL.

| Type | Trigger | Priority | Action URL |
|------|---------|----------|------------|
| follow_up | Leads with new/contacted/follow-up status | Based on count | /dashboard/communications |
| pipeline_bottleneck | >60% of leads stuck in early stages | high | /dashboard/leads |
| capacity_warning | >6 appointments in one day | high | /dashboard/calendar |
| revenue_opportunity | Lead worth >$1,000 | high | /dashboard/communications |
| scheduling_conflict | Overlapping appointments | medium | /dashboard/calendar |
| lost_opportunity | Lost leads exist | low | /dashboard/leads |
| schedule_optimization | Jobs completed faster than estimated | low | /dashboard/calendar |

Recommendations are persisted and can be resolved. The Dashboard can display unresolved recommendations.

---

## 7. API Reference

### Base URL: `/api/v1/polaris`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /status | Health check |
| GET | /intelligence | Full dashboard intelligence |
| POST | /estimate | Generate estimate |
| POST | /complete | Record completed job |
| GET | /learning | Learning metrics + predictions |
| POST | /recommendations/generate | Generate recommendations |
| GET | /recommendations | Get recommendations |
| PUT | /recommendations/:id/resolve | Mark recommendation resolved |
| GET | /jobs | Completed jobs |
| GET | /estimates | Historical estimates |
| POST | /query | ChatGPT query interface |
| GET | /retell-context | Retell AI context |
| GET | /pipeline | Pipeline analysis |
| POST | /pipeline | Pipeline analysis (with leads) |
| POST | /config | Update estimation config |

---

## 8. Future AI Interfaces

### 8.1 ChatGPT Integration

Prepared interface: `POST /api/v1/polaris/query`

ChatGPT sends a natural language query plus context data. Polaris returns structured intelligence based on the query type:

- "What jobs will run late?" → Schedule analysis + conflict detection
- "Why is pipeline down?" → Pipeline analysis + bottleneck detection
- "Which estimates are profitable?" → Historical estimate comparison
- "What needs follow-up?" → Follow-up recommendations

Polaris remains the source of truth. ChatGPT is the conversational interface.

### 8.2 Retell AI Integration

Prepared interface: `GET /api/v1/polaris/retell-context`

Returns:
- Available scheduling slots (next 7 days)
- Crew availability and skills
- Schedule summary
- Capacity information

Retell AI can use this to:
- Schedule appointments
- Answer availability questions
- Estimate appointment duration
- Recommend scheduling windows

---

## 9. Multi-Crew Architecture (Future)

The data model supports:

- Crew records with skills, equipment, vehicle assignments
- Crew efficiency tracking (rolling average of duration variance)
- Crew-level scheduling (future)

When multi-crew dispatch is implemented:
- Each job assigns a crewId
- Each crew's efficiency is tracked independently
- Schedule optimization assigns jobs to the most efficient crew
- Equipment and vehicle scheduling prevents conflicts

---

## 10. Calendar Intelligence Architecture (Future)

The data model supports:

- **Estimated job duration** — per service type, adjusted by learning
- **Travel time** — between job sites
- **Available scheduling gaps** — computed from existing events
- **Capacity forecasting** — based on total booked hours vs available hours
- **Suggested appointment windows** — based on historical peak efficiency times
- **Conflict detection** — overlapping appointments by time
- **Overbooking detection** — more than N appointments per day
- **Schedule optimization** — reorder appointments to minimize travel time

---

## 11. Operations Intelligence Roadmap

### Phase 2 (Current) — Foundation
- ✅ Backend Polaris engine with estimation, learning, recommendations
- ✅ Persistent storage (file-backed, PostgreSQL-ready)
- ✅ API routes for all operations
- ✅ Data model with complete schemas
- ✅ Future AI interfaces prepared

### Phase 3 — Calendar Intelligence
- Drag-and-drop scheduling
- Travel time optimization
- Capacity forecasting
- Conflict detection live

### Phase 4 — Dispatch Center
- Multi-crew management
- Equipment scheduling
- Route optimization
- Real-time crew tracking

### Phase 5 — AI Integration
- ChatGPT conversational queries
- Retell AI voice scheduling
- Automated recommendations
- Predictive analytics

### Phase 6 — Full Autonomy
- Self-optimizing schedule
- Automated dispatch
- Revenue forecasting
- Business intelligence reporting

---

## 12. File Reference

| File | Purpose |
|------|---------|
| `src/polaris/engine.js` | Core engine — all Polaris operations |
| `src/polaris/store.js` | Persistent storage (JSON file, ready for PostgreSQL) |
| `src/polaris/data-model.js` | Schema definitions with PostgreSQL DDL |
| `src/polaris/estimation.js` | Multi-variable estimation engine |
| `src/polaris/learning.js` | Self-learning from completed jobs |
| `src/polaris/recommendations.js` | Recommendation generation |
| `src/routes/polaris.js` | API routes |
| `data/polaris-*.json` | Persistent data files |

---

## 13. Summary

✓ Polaris Engine architecture — backend service, not page-specific
✓ Data model — CompletedJob, Estimate, LearningMetrics, Crew, Recommendation schemas
✓ Learning pipeline — every job trains future predictions
✓ Estimation framework — 7 weighted variables, service-type specific
✓ Recommendation framework — 7 types, priority-driven, actionable
✓ Future AI interface — ChatGPT and Retell AI queries prepared
✓ Multi-crew architecture — data model supports crew tracking
✓ Calendar intelligence architecture — data model supports scheduling optimization
✓ Operations intelligence roadmap — 6 phases to full autonomy