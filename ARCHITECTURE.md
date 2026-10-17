# BitByte — System Architecture Deep Dive

> **BitByte** is a multi-tenant, QR-based food ordering platform. Restaurant owners generate QR codes per table; customers scan them to browse the menu and place orders in real-time. Owners manage everything through a live dashboard.

---

## Table of Contents

1. [High-Level Overview](#1-high-level-overview)
2. [Repository Structure](#2-repository-structure)
3. [Deployment Architecture](#3-deployment-architecture)
4. [Frontend — Next.js App Router](#4-frontend--nextjs-app-router)
5. [Backend — Express API Server](#5-backend--express-api-server)
6. [Data Layer — MongoDB](#6-data-layer--mongodb)
7. [Real-Time Layer — Socket.IO](#7-real-time-layer--socketio)
8. [Authentication Flow](#8-authentication-flow)
9. [Customer Order Flow (QR → Order → Kitchen)](#9-customer-order-flow-qr--order--kitchen)
10. [Owner Dashboard Flow](#10-owner-dashboard-flow)
11. [Analytics Pipeline](#11-analytics-pipeline)
12. [Caching Architecture](#12-caching-architecture)
13. [Security Model](#13-security-model)
14. [Environment Variables Reference](#14-environment-variables-reference)
15. [Key Design Decisions](#15-key-design-decisions)

---

## 1. High-Level Overview

```mermaid
graph TB
    subgraph Clients["Clients (Browser)"]
        C["📱 Customer\n(scans QR)"]
        O["💼 Owner\n(dashboard)"]
    end

    subgraph Vercel["Vercel / CDN Edge"]
        NX["Next.js 16\nApp Router"]
    end

    subgraph EC2["AWS EC2 (PM2)"]
        EX["Express API\nPort 3001"]
        SIO["Socket.IO\n/api/socket"]
        PINO["Pino Logger"]
    end

    subgraph Cache["Cache Layer"]
        RD["Redis\n• Sessions\n• Analytics cache\n• Socket.IO adapter"]
    end

    subgraph DB["Data Layer"]
        MDB["MongoDB Atlas\n5 Collections"]
    end

    subgraph Storage["Media Storage"]
        CLD["Cloudinary\n(menu images)"]
    end

    C --> NX
    O --> NX
    NX -- "Server Actions\n+ API fetch" --> EX
    EX -- "Mongoose ODM" --> MDB
    EX -- "ioredis" --> RD
    EX --> SIO
    SIO -- "redis-adapter" --> RD
    NX -- "WebSocket" --> SIO
    EX -- "SDK" --> CLD
    SIO -- "push events" --> O
```

---

## 2. Repository Structure

```
gamma/                          ← Monorepo root
│
├── client/                     ← Next.js 16 Frontend
│   ├── app/                    ← App Router pages & layouts
│   │   ├── auth/signin/        ← Login page
│   │   ├── onboarding/         ← Post-signup restaurant setup
│   │   ├── dashboard/          ← Owner dashboard (auth-protected)
│   │   │   ├── menu/           ← Menu item CRUD
│   │   │   ├── orders/         ← Live order management
│   │   │   ├── tables/         ← Table + QR code manager
│   │   │   ├── analytics/      ← Revenue & item analytics
│   │   │   └── profile/        ← Restaurant settings
│   │   ├── table/
│   │   │   └── [restaurantId]/
│   │   │       └── [tableId]/  ← Customer menu page (public)
│   │   │           └── order-status/ ← Customer order tracker
│   │   └── actions/            ← Next.js Server Actions
│   │       ├── auth.ts         ← signIn / signUp
│   │       └── order.ts        ← createOrder / updateStatus
│   ├── components/
│   │   ├── customer/           ← CustomerMenu, Cart components
│   │   ├── dashboard/          ← Dashboard layout, nav
│   │   └── ui/                 ← Button, Modal, shared UI kit
│   ├── lib/
│   │   ├── auth.ts             ← NextAuth v5 configuration
│   │   ├── auth.config.ts      ← JWT callbacks (restaurantId injection)
│   │   ├── db.ts               ← MongoDB connection (maxPool: 1)
│   │   ├── api.ts              ← apiFetch() — cookie-forwarding helper
│   │   ├── session.ts          ← Anonymous customer session (localStorage)
│   │   └── socket.ts           ← Socket.IO client singleton
│   ├── hooks/
│   │   └── useSocket.ts        ← React hook for Socket.IO subscription
│   └── models/                 ← Shared Mongoose schema (mirrors server/)
│
├── server/                     ← Express API Backend
│   ├── index.ts                ← App entrypoint, middleware wiring
│   ├── controllers/            ← Request handlers (thin, delegate to services)
│   │   ├── AuthController.ts
│   │   ├── MenuController.ts
│   │   ├── OrderController.ts
│   │   ├── RestaurantController.ts
│   │   ├── TableController.ts
│   │   ├── AnalyticsController.ts
│   │   └── UploadController.ts
│   ├── services/               ← Business logic layer
│   │   ├── OrderService.ts     ← Price validation, order creation
│   │   ├── MenuService.ts      ← Item upsert, category normalization
│   │   └── TenantService.ts    ← Restaurant lookup by slug
│   ├── routes/                 ← Express Router definitions
│   ├── middleware/
│   │   ├── auth.ts             ← JWT decode → req.user
│   │   ├── cors.ts             ← Env-driven CORS allowlist
│   │   ├── rateLimiter.ts      ← express-rate-limit (3 profiles)
│   │   └── requestLogger.ts    ← pino-http HTTP logging
│   ├── models/                 ← Mongoose schemas (source of truth)
│   ├── lib/
│   │   ├── db.ts               ← MongoDB connection (maxPool: 10)
│   │   ├── redis.ts            ← ioredis singleton
│   │   ├── logger.ts           ← pino structured logger
│   │   └── qrcode.ts           ← QR data-URL generator
│   ├── socket/
│   │   └── index.ts            ← Socket.IO init + Redis adapter
│   └── types/
│       └── express.d.ts        ← AuthenticatedUser type augmentation
│
├── ecosystem.config.cjs        ← PM2 production config
├── package.json                ← Monorepo scripts
└── .env.local                  ← Shared environment variables
```

---

## 3. Deployment Architecture

### Development Mode (Split, 2 processes)

```mermaid
graph LR
    Browser --> NX["Next.js Dev\n:3000\nnpm run dev:frontend"]
    NX -- "fetch + cookie forward\nvia apiFetch()" --> EX["Express API\n:3001\nnpm run dev:backend\nAPI_ONLY=true"]
    EX --> MDB[("MongoDB Atlas")]
    EX -.-> RD[("Redis\nOptional")]
```

### Production Mode (Unified, 1 process on EC2)

```mermaid
graph LR
    Internet --> PM2["PM2\nnode server/index.js\nPort 3000"]
    PM2 --> EX["Express\nHandles /api/v1/*\n+ Socket.IO"]
    PM2 --> NX["Next.js\nCatch-all handler\nfor all other routes"]
    EX --> MDB[("MongoDB Atlas")]
    EX --> RD[("Redis\nRequired in prod")]
    RD -- "Socket.IO\nredis-adapter" --> EX
```

> In production, Express boots first, attaches Socket.IO, then hands all non-API routes to the Next.js request handler. This avoids running two separate Node processes.

---

## 4. Frontend — Next.js App Router

### Route Map

```mermaid
graph TD
    Root["/"] --> Auth["/auth/signin"]
    Root --> Onboard["/onboarding"]
    Root --> Dash["/dashboard\n🔒 Auth Required"]
    Root --> Table["/table/:restaurantId/:tableId\n🌐 Public"]

    Dash --> DMenu["/dashboard/menu"]
    Dash --> DOrders["/dashboard/orders"]
    Dash --> DTables["/dashboard/tables"]
    Dash --> DAnalytics["/dashboard/analytics"]
    Dash --> DProfile["/dashboard/profile"]

    Table --> OrderStatus["/table/:rId/:tId/order-status"]

    style Dash fill:#3b82f6,color:#fff
    style Table fill:#10b981,color:#fff
    style Auth fill:#6366f1,color:#fff
```

### Server vs Client Components

```mermaid
graph TD
    subgraph "Server Components (RSC)"
        DashPage["dashboard/page.tsx\n• Reads session\n• Queries MongoDB directly\n• Renders stats server-side"]
        TablePage["table/.../page.tsx\n• Fetches menu/restaurant/table\n• next/cache unstable_cache\n• 60s revalidation"]
    end

    subgraph "Client Components"
        CustMenu["CustomerMenu.tsx\n• Cart state\n• Category filter\n• Calls createOrder SA"]
        CartComp["Cart.tsx\n• Quantity controls\n• Order placement form"]
        OrdersDash["orders/page.tsx\n• useSocket() hook\n• Live order list\n• Status buttons"]
    end

    subgraph "Server Actions"
        SAOrder["actions/order.ts\n• createOrder()\n• updateOrderStatus()\n• updatePaymentStatus()\n• getOrdersBySession()"]
        SAAuth["actions/auth.ts\n• signInAction()\n• signUpAction()"]
    end

    DashPage -- "Passes data as props" --> OrdersDash
    TablePage -- "Passes data as props" --> CustMenu
    CustMenu --> CartComp
    CustMenu -- "calls" --> SAOrder
    OrdersDash -- "calls" --> SAOrder
```

### Data Fetching Strategy

| Page | Strategy | Why |
|------|----------|-----|
| `/dashboard` | Direct MongoDB via Mongoose (RSC) | Auth-gated, always fresh |
| `/dashboard/orders` | `apiFetch()` Server Action → Express | Needs auth cookie forwarding |
| `/table/:id/:id` | `unstable_cache` → Express REST | Public, cacheable 60s |
| `/dashboard/analytics` | `apiFetch()` Server Action → Express | Complex aggregations, Redis cached |

---

## 5. Backend — Express API Server

### Middleware Stack (request pipeline)

```mermaid
flowchart TD
    REQ["Incoming HTTP Request"] --> RLOG["requestLogger\npino-http\nAssigns X-Request-ID"]
    RLOG --> CORS["corsMiddleware\nEnv-driven allowlist\nCredentials: true"]
    CORS --> JSON["express.json()\nlimit: 10mb"]
    JSON --> SESSION["express-session\nRedisStore / MemoryStore"]
    SESSION --> ROUTE{"Route Matcher"}

    ROUTE -- "/api/v1/orders POST" --> RL1["orderRateLimiter\n10 req/min/IP"]
    ROUTE -- "/api/v1/menu/public/:id" --> RL2["publicReadLimiter\n120 req/min/IP"]
    ROUTE -- "/api/v1/auth/*" --> RL3["authRateLimiter\n10 req/15min/IP"]
    ROUTE -- "Protected routes" --> AUTH["authMiddleware\nDecodes NextAuth JWT\n→ req.user: AuthenticatedUser"]

    RL1 --> CTRL["Controller"]
    RL2 --> CTRL
    RL3 --> CTRL
    AUTH --> CTRL
    CTRL --> SVC["Service Layer"]
    SVC --> MDB[("MongoDB")]
    SVC --> RD[("Redis")]
```

### API Endpoints

```
POST   /api/v1/auth/signup              ← Create owner account + restaurant
POST   /api/v1/auth/verify              ← Validate credentials (NextAuth callback)

GET    /api/v1/restaurant               ← Owner: get restaurant profile
PUT    /api/v1/restaurant               ← Owner: update profile/branding

GET    /api/v1/menu                     ← Owner: all items
POST   /api/v1/menu                     ← Owner: create item
PUT    /api/v1/menu/:id                 ← Owner: update item
DELETE /api/v1/menu/:id                 ← Owner: delete item
PATCH  /api/v1/menu/:id/toggle          ← Owner: toggle availability
GET    /api/v1/menu/public/:restaurantId← Public: customer menu (cached)

GET    /api/v1/tables                   ← Owner: all tables
POST   /api/v1/tables                   ← Owner: create table + gen QR
DELETE /api/v1/tables/:id               ← Owner: delete table
PATCH  /api/v1/tables/:id/toggle        ← Owner: activate/deactivate
GET    /api/v1/tables/public/:id        ← Public: table info for customer

GET    /api/v1/orders                   ← Owner: recent orders (paginated)
POST   /api/v1/orders                   ← Public: customer places order
GET    /api/v1/orders/by-session        ← Public: customer order tracker
PATCH  /api/v1/orders/:id/status        ← Owner: update order status
PATCH  /api/v1/orders/:id/payment       ← Owner: mark order paid

GET    /api/v1/analytics/metrics        ← Owner: revenue + top items (cached)
GET    /api/v1/analytics/associations   ← Owner: "bought together" (cached)

POST   /api/v1/upload                   ← Owner: upload image to Cloudinary

GET    /api/health                      ← Health check (no logging)
```

### Controller → Service → Model Layering

```mermaid
flowchart LR
    subgraph "Controllers (thin)"
        OC["OrderController\n• Auth check\n• Call service\n• Emit socket event\n• Return response"]
    end

    subgraph "Services (business logic)"
        OS["OrderService\n• Validate ObjectIds\n• Fetch prices from DB\n• Reject tampered prices\n• Calculate total\n• Save order"]
    end

    subgraph "Models (data)"
        OM["Order\n• Mongoose Schema\n• Indexes\n• Validation"]
    end

    OC --> OS --> OM
```

---

## 6. Data Layer — MongoDB

### Collections & Schema Relationships

```mermaid
erDiagram
    USER {
        ObjectId _id PK
        string email UK
        string password "bcrypt hash"
        string name
        string role "restaurant_owner"
        ObjectId restaurantId FK
    }

    RESTAURANT {
        ObjectId _id PK
        string name
        string slug UK
        ObjectId ownerId FK
        string upiId
        string themeColor
        string fontFamily
        string colorScheme
        number gstPercentage
        string status "active|suspended|onboarding"
        string logoUrl
        string coverImageUrl
    }

    TABLE {
        ObjectId _id PK
        string tableNumber
        ObjectId restaurantId FK
        string qrCodeDataUrl "Base64 PNG"
        boolean isActive
    }

    MENUITEM {
        ObjectId _id PK
        string name
        string category
        number price
        string imageUrl "Cloudinary URL"
        boolean isAvailable
        ObjectId restaurantId FK
    }

    ORDER {
        ObjectId _id PK
        ObjectId restaurantId FK
        ObjectId tableId FK
        array items "embedded subdocs"
        number total "server-calculated"
        string status "pending|preparing|served|completed|cancelled"
        string paymentStatus "pending|paid"
        string sessionId "anonymous customer"
        string customerName
        string customerPhone
        string notes
    }

    USER ||--|| RESTAURANT : "owns"
    RESTAURANT ||--o{ TABLE : "has"
    RESTAURANT ||--o{ MENUITEM : "has"
    RESTAURANT ||--o{ ORDER : "receives"
    TABLE ||--o{ ORDER : "from"
```

### MongoDB Indexes

| Collection | Index | Purpose |
|-----------|-------|---------|
| Restaurant | `slug` unique | Lookup by URL slug |
| Restaurant | `customDomain` sparse unique | Custom domain routing |
| MenuItem | `{ restaurantId, category }` | Filtered menu fetch |
| MenuItem | `{ restaurantId, isAvailable }` | Public menu (available only) |
| Table | `{ restaurantId, tableNumber }` unique | Duplicate prevention |
| Order | `{ restaurantId, createdAt: -1 }` | Dashboard order list |
| Order | `{ tableId, createdAt: -1 }` | Per-table order history |
| Order | `{ sessionId, tableId }` **compound** | Customer order status lookup |
| Order | `{ status, restaurantId }` | Status filter queries |
| Order | `{ restaurantId, status, createdAt: -1 }` | Analytics aggregations |

---

## 7. Real-Time Layer — Socket.IO

### Event Architecture

```mermaid
sequenceDiagram
    participant OD as Owner Dashboard
    participant SIO as Socket.IO Server
    participant RD as Redis Pub/Sub
    participant API as Express API
    participant CUST as Customer

    OD->>SIO: connect()
    OD->>SIO: emit('join-restaurant', restaurantId)
    SIO->>SIO: socket.join('restaurant-{id}')
    Note over SIO,RD: Redis adapter syncs rooms across instances

    CUST->>API: POST /api/v1/orders
    API->>API: OrderService.createOrder()
    API->>SIO: io.to('restaurant-{id}').emit('new-order', order)
    SIO->>RD: publish to channel
    RD->>SIO: broadcast to all instances
    SIO->>OD: 'new-order' event received
    OD->>OD: Append order to dashboard list

    OD->>API: PATCH /orders/:id/status {status: 'preparing'}
    API->>SIO: io.to('restaurant-{id}').emit('order-updated', order)
    SIO->>OD: 'order-updated' event
    OD->>OD: Update order card status
```

### Multi-Instance Socket.IO (with Redis Adapter)

```mermaid
graph LR
    subgraph "EC2 Instance A"
        SIO_A["Socket.IO\nIn-Memory Rooms"]
        EX_A["Express API"]
    end
    subgraph "EC2 Instance B"
        SIO_B["Socket.IO\nIn-Memory Rooms"]
        EX_B["Express API"]
    end

    RD[("Redis\nPub/Sub Channels")]

    SIO_A <--> RD
    SIO_B <--> RD

    Owner["Owner Browser"] -- "WebSocket" --> SIO_A
    EX_B -- "emit('new-order')" --> SIO_B
    SIO_B -- "publish" --> RD
    RD -- "subscribe → forward" --> SIO_A
    SIO_A -- "push" --> Owner
```

> Without the Redis adapter, if the Owner's browser is connected to Instance A but the order hits Instance B, the owner would **never see** the real-time notification.

---

## 8. Authentication Flow

### Owner Login (NextAuth v5 + JWT)

```mermaid
sequenceDiagram
    participant Browser
    participant NextJS as Next.js Server
    participant NextAuth as NextAuth v5
    participant Express as Express /api/v1/auth/verify
    participant MongoDB

    Browser->>NextJS: POST /auth/signin {email, password}
    NextJS->>NextAuth: signIn('credentials', ...)
    NextAuth->>Express: POST /api/v1/auth/verify {email, password}
    Express->>MongoDB: User.findOne({ email })
    MongoDB-->>Express: User document
    Express->>Express: bcrypt.compare(password, hash)
    Express-->>NextAuth: { id, email, name, role, restaurantId }
    NextAuth->>NextAuth: jwt() callback\n→ token.restaurantId = user.restaurantId
    NextAuth->>NextAuth: Sign JWT with AUTH_SECRET
    NextAuth-->>Browser: Set-Cookie: next-auth.session-token (HttpOnly)
    Browser->>NextJS: Subsequent requests with cookie
    NextJS->>NextJS: auth() → decode JWT → session.user.restaurantId
```

### Express API Auth (Server Actions → Express)

```mermaid
sequenceDiagram
    participant SA as Server Action (apiFetch)
    participant Express
    participant AuthMW as authMiddleware

    SA->>Express: fetch('/api/v1/orders')\nCookie: next-auth.session-token=...
    Express->>AuthMW: Intercept request
    AuthMW->>AuthMW: Extract token from Cookie header\n(regex match for next-auth.session-token\nor authjs.session-token)
    AuthMW->>AuthMW: decode(token, AUTH_SECRET, salt)
    Note over AuthMW: salt = cookie name (varies prod vs dev)
    AuthMW->>AuthMW: Validate decoded.restaurantId exists
    AuthMW->>Express: next() — req.user = AuthenticatedUser
    Express->>Express: Controller uses req.user.restaurantId
    Express-->>SA: Response
```

### Anonymous Customer Session

```mermaid
flowchart LR
    QR["Customer scans QR"] --> PAGE["Next.js loads\n/table/:rId/:tId"]
    PAGE --> LS{"localStorage\nhas session_id?"}
    LS -- "No" --> GEN["crypto.randomBytes(32)\n→ hex string\nStore in localStorage"]
    LS -- "Yes" --> USE["Use existing session_id"]
    GEN --> USE
    USE --> ORDER["Session ID sent\nwith every order\nPOST /api/v1/orders\n{ sessionId, tableId, ... }"]
    ORDER --> TRACK["Customer visits /order-status\nGET /by-session?sessionId=...&tableId=...\n→ All orders for this visit"]
```

---

## 9. Customer Order Flow (QR → Order → Kitchen)

```mermaid
flowchart TD
    QR["📱 Customer scans QR Code\n/table/{restaurantId}/{tableId}"]

    QR --> LOAD["Next.js Server Component\nParallel fetch (Promise.all):\n• getCachedRestaurant()\n• getCachedTable()\n• getCachedMenu()\n60s unstable_cache TTL"]

    LOAD --> VALIDATE{"restaurant exists\nAND\ntable.restaurantId matches?"}
    VALIDATE -- "No" --> 404["notFound() → 404 page"]
    VALIDATE -- "Yes" --> RENDER["Render CustomerMenu\n(Client Component)"]

    RENDER --> BROWSE["Customer browses menu\nFilters by category\nAdds items to cart state"]

    BROWSE --> CART["Cart drawer opens\nCustomer enters name, phone,\nspecial instructions"]

    CART --> SA["createOrder() Server Action\ncalls apiFetch('/api/v1/orders')"]

    SA --> RL["orderRateLimiter\n10 req/min/IP"]
    RL --> OC["OrderController.create()"]
    OC --> OS["OrderService.createOrder()"]

    OS --> PRICECHECK["Fetch all menuItemIds\nfrom DB scoped to restaurantId\nReject any unknown items\nEnforce DB prices (ignore client)"]

    PRICECHECK --> SAVE["new Order(data).save()"]
    SAVE --> EMIT["io.to('restaurant-{id}')\n.emit('new-order', order)"]

    EMIT --> OWNER["Owner Dashboard\nreceives 'new-order' event\nOrder appears instantly"]

    SAVE --> REDIRECT["Customer → /order-status\nPolls getOrdersBySession()"]

    style QR fill:#f59e0b,color:#000
    style OWNER fill:#10b981,color:#fff
    style PRICECHECK fill:#ef4444,color:#fff
```

---

## 10. Owner Dashboard Flow

### Order Lifecycle Management

```mermaid
stateDiagram-v2
    [*] --> pending: Customer places order\n(POST /api/v1/orders)
    pending --> preparing: Owner clicks "Preparing"\n(PATCH /orders/:id/status)
    preparing --> served: Owner clicks "Served"\n(PATCH /orders/:id/status)
    served --> completed: Owner closes order\n(PATCH /orders/:id/status)
    pending --> cancelled: Owner cancels\n(PATCH /orders/:id/status)
    preparing --> cancelled: Owner cancels

    served --> paid: Mark payment received\n(PATCH /orders/:id/payment)
    completed --> paid: Mark payment received

    note right of pending
        Socket.IO emits
        'new-order' → Dashboard
    end note

    note right of preparing
        Socket.IO emits
        'order-updated' → Dashboard
    end note
```

### Dashboard Data Flow

```mermaid
flowchart LR
    subgraph "Dashboard Layout (Server)"
        AUTH["auth()\n→ session.user.restaurantId"]
    end

    subgraph "Dashboard /page.tsx (RSC)"
        PAR["Promise.all()\n• Order.countDocuments\n• MenuItem.countDocuments\n• Table.countDocuments\n• Order.aggregate (today revenue)"]
    end

    subgraph "Orders /page.tsx (Client)"
        SOCK["useSocket(restaurantId)\n→ Socket.IO connection\n→ join-restaurant room"]
        INIT["Initial load:\ngetOrders() Server Action"]
        EVT["on('new-order') →\nappend to list\non('order-updated') →\nreplace in list"]
    end

    AUTH --> PAR
    AUTH --> SOCK
    SOCK --> INIT
    SOCK --> EVT
```

---

## 11. Analytics Pipeline

```mermaid
flowchart TD
    REQ["GET /api/v1/analytics/metrics\n?startDate=...&endDate=..."]
    REQ --> AUTH["authMiddleware\nExtract restaurantId"]
    AUTH --> CACHEKEY["Build Redis key:\nbitbyte:analytics:metrics\n:{restaurantId}:{start}:{end}"]
    CACHEKEY --> REDISGET{"Redis GET\ncached?"}

    REDISGET -- "HIT" --> RETURN["Return cached JSON\nX-Cache: HIT header\n~1ms response"]

    REDISGET -- "MISS" --> AGGS["Promise.all() — 3 MongoDB Aggregations:\n1. Period revenue + order count\n2. All-time revenue + order count\n3. Top 5 items by quantity sold"]

    AGGS --> FORMAT["Build payload object"]
    FORMAT --> CACHESET["redis.set(key, payload, EX, 300)\nFire-and-forget (non-blocking)"]
    CACHESET --> RETURN2["Return JSON\nX-Cache: MISS header"]

    subgraph "Association Mining (getAssociations)"
        ASSOC_MISS["Fetch all orders\nwith status completed/served\n.lean() — no hydration"]
        ASSOC_MISS --> COMBO["For each order:\n• Build 2-item pairs O(n²)\n• Build 3-item triplets O(n³)\n• Tally frequency counts"]
        COMBO --> FILTER["Filter frequency > 1\nSort descending\nReturn top 15"]
        FILTER --> ASSOC_CACHE["Redis SET\nTTL: 10 minutes"]
    end

    style RETURN fill:#10b981,color:#fff
    style REDISGET fill:#6366f1,color:#fff
```

---

## 12. Caching Architecture

```mermaid
graph TD
    subgraph "Next.js Cache (CDN / Vercel)"
        UC["unstable_cache\n• menu data (60s)\n• restaurant data (60s)\n• table data (60s)\nKey: tag-based revalidation"]
    end

    subgraph "Express Redis Cache"
        RC1["Analytics Metrics\nKey: bitbyte:analytics:metrics:{rId}:{start}:{end}\nTTL: 5 minutes"]
        RC2["Analytics Associations\nKey: bitbyte:analytics:assoc:{rId}:{start}:{end}\nTTL: 10 minutes"]
    end

    subgraph "HTTP Cache Headers"
        CC["Cache-Control: public, max-age=60\nstale-while-revalidate=300\nOn: GET /api/v1/menu/public/:id"]
    end

    subgraph "Session Cache"
        SC["Redis Session Store\nKey: bitbyte:sess:{sessionId}\nTTL: 7 days"]
    end

    QR["Customer QR Scan"] --> UC --> CC
    OWNER["Owner Analytics"] --> RC1
    OWNER --> RC2
    OWNER_LOGIN["Owner Login"] --> SC
```

### Cache Invalidation Strategy

| Cache | Invalidation Trigger |
|-------|---------------------|
| `unstable_cache` menu | Tag `menu-{restaurantId}` — revalidated on menu CRUD via `revalidateTag()` |
| Analytics Redis | Time-based TTL expiry (no explicit invalidation) |
| HTTP `Cache-Control` | Browser/CDN obeys `max-age=60`; Cloudflare can be purged manually |
| Session Redis | 7-day TTL; destroyed on explicit signOut |

---

## 13. Security Model

### Multi-Tenant Isolation

```mermaid
flowchart LR
    JWT["JWT Token\n{ restaurantId: 'abc123' }"] --> MW["authMiddleware\nreq.user.restaurantId = 'abc123'"]
    MW --> QUERY["Every DB query:\nMenuItem.find({ restaurantId: 'abc123' })\nOrder.findOne({ _id: id, restaurantId: 'abc123' })"]
    QUERY --> SCOPE["Owner can ONLY see\ntheir own data\nNo cross-tenant leakage"]
```

### Price Tampering Prevention

```mermaid
flowchart TD
    CLIENT["Customer sends order:\n{ items: [{ menuItemId, price: 0 }] }"] -->|"POST /api/v1/orders"| OS["OrderService.createOrder()"]
    OS --> DB["Fetch MenuItem from DB\nscoped to restaurantId"]
    DB --> OVERRIDE["Use DB price, ignore client price\ncalculatedTotal += dbItem.price × quantity"]
    OVERRIDE --> ORDER["Order.save() with correct total"]
    OVERRIDE --> REJECT{"DB item found?"}
    REJECT -- "No" --> ERR["throw Error: item invalid\n→ 500 response"]
```

### Rate Limiting Profiles

| Profile | Routes | Limit | Window |
|---------|--------|-------|--------|
| `authRateLimiter` | `/auth/signup`, `/auth/verify` | 10 req | 15 min |
| `orderRateLimiter` | `POST /orders` | 10 req | 1 min |
| `publicReadLimiter` | `/menu/public/*`, `/orders/by-session` | 120 req | 1 min |

### CORS Policy

```mermaid
flowchart LR
    REQ["Incoming Request\nOrigin: https://mybistro.com"] --> MW["corsMiddleware"]
    MW --> CHECK{"origin in\nallowed list?"}
    CHECK -- "Yes" --> ALLOW["Access-Control-Allow-Origin: https://mybistro.com\nAccess-Control-Allow-Credentials: true"]
    CHECK -- "No" --> DENY["Access-Control-Allow-Origin: null\n(browser blocks response)"]
    CHECK -- "No origin header\n(server-to-server)" --> OPEN["Access-Control-Allow-Origin: *"]
```

Allowed origins: `NEXTAUTH_URL`, `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_APP_URL`, plus localhost variants in development.

---

## 14. Environment Variables Reference

| Variable | Used By | Required | Purpose |
|----------|---------|----------|---------|
| `MONGODB_URI` | Server + Client | ✅ | MongoDB Atlas connection string |
| `AUTH_SECRET` | Server + Client | ✅ | NextAuth JWT signing key |
| `NEXTAUTH_SECRET` | Client | ✅ | NextAuth fallback secret |
| `NEXTAUTH_URL` | Client | ✅ | App base URL (NextAuth callbacks) |
| `BACKEND_URL` | Server | ✅ prod | Express API URL (e.g. `https://api.bistro.com`) |
| `NEXT_PUBLIC_BASE_URL` | Server | ✅ | QR code URL base (e.g. `https://bistro.com`) |
| `REDIS_URL` | Server | ✅ prod | Redis connection (sessions + analytics cache) |
| `CLOUDINARY_CLOUD_NAME` | Server | ✅ | Cloudinary account |
| `CLOUDINARY_API_KEY` | Server | ✅ | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Server | ✅ | Cloudinary API secret |
| `SIGNUP_SECRET_KEY` | Server | ✅ | Gate for new restaurant signups |
| `LOG_LEVEL` | Server | ❌ | Pino log level (default: `info` in prod, `debug` in dev) |
| `PORT` | Server | ❌ | Express port (default: `3000`) |
| `NODE_ENV` | Both | ❌ | `production` / `development` |
| `API_ONLY` | Server | ❌ | `true` = skip Next.js handler (split mode) |

---

## 15. Key Design Decisions

### Why Express + Next.js together (not Next.js API routes)?

Next.js API routes run in a **serverless/edge** environment where persistent connections (Socket.IO, long-lived Redis pub/sub) are impossible. Express owns the HTTP server, allowing Socket.IO to attach to it directly. Next.js is then used as a rendering engine, not as an API server.

### Why MongoDB over PostgreSQL?

Menu items and orders have variable-length embedded arrays (items, modifiers) that map naturally to MongoDB documents. The restaurant customisation schema (theme, fonts, GST config) changes per tenant without requiring schema migrations.

### Why anonymous sessions (localStorage) for customers?

Customers should not need an account to order food. The `sessionId` generated on first QR scan ties their orders together for the duration of the visit. No PII collection required, no login friction.

### Why Redis is optional in development but required in production?

In development you rarely have Redis available locally. The fallback to `MemoryStore` is acceptable for single-developer testing. In production, `MemoryStore` grows unboundedly and is cleared on every restart — Redis is enforced via a startup assertion.

### Why `maxPoolSize: 10` on Express but `1` on Next.js?

Express handles many concurrent HTTP requests — it needs multiple DB connections in the pool to serve them in parallel. Next.js in the App Router invokes each Server Component as a relatively short-lived serverless-style function — a pool of 1 (with caching) prevents connection exhaustion on Vercel or serverless deployments.
