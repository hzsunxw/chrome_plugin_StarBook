# 基于 MongoDB 的通讯接口设计 (完整版)

## 1. 统一数据模型与认证

### 1.1 数据模型 (Data Model)
所有完整的书签对象都应遵循统一的 JSON 格式。在不同的接口和事件中，可能会根据操作需要传输对象的部分字段。一个完整的书签对象包含以下关键字段：

```json
{
  "_id": "60f8e1b9b3f4e1a4c8f0b1c2",
  "userId": "5f8e1b9b3f4e1a4c8f0b1a9",
  "url": "https://example.com",
  "title": "示例标题",
  "summary": "这是书签的摘要...",
  "tags": ["技术", "参考"],
  "notes": "这是一些笔记内容。",
  "contentType": "参考",
  "estimatedReadTime": "13分钟",
  "readingLevel": "初级",
  "isStarred": false,
  "isDeleted": false,
  "type": "bookmark",
  "parentId": "root",
  "dateAdded": "2025-08-07T05:51:00.000Z",
  "lastModified": "2025-08-07T05:51:00.000Z"
}
```

**关于 ID 的说明:**
- `_id`: 由 MongoDB 生成的唯一、永久的身份标识。所有已同步的书签都拥有此 ID。它是所有更新和删除操作的唯一凭证。
- `clientId`: 客户端在本地创建新书签时，应生成一个临时的、唯一的 ID (如 UUID)。这个 clientId 仅用于在书签成功同步到服务器之前进行本地追踪。服务器不会存储 clientId。

### 1.2 认证方式 (Authentication)
所有需要用户身份的 API 请求，都必须在 HTTP Header 中携带 JSON Web Token (JWT)。

**Header 格式:**  
`Authorization: Bearer <your_jwt_token>`

WebSocket 连接在建立时，也需要在连接参数中传递 JWT，以便服务器识别用户身份并将其与对应的 socket 连接关联起来。

## 2. RESTful API 接口设计 (用于认证和数据同步)

### 2.1 用户认证 (Authentication)
**POST /api/auth/register**  
功能: 用户邮箱/密码注册。  

**请求体 (Body):**  
```json
{ 
  "email": "user@example.com", 
  "password": "a_strong_password" 
}
```

**成功响应 (201):**  
```json
{ "message": "User registered successfully" }
```

**失败响应 (409):**  
```json
{ "error": "Email already exists" }
```

---

**POST /api/auth/login**  
功能: 用户邮箱/密码登录。  

**请求体 (Body):**  
```json
{ 
  "email": "user@example.com", 
  "password": "a_strong_password" 
}
```

**成功响应 (200):**  
```json
{ 
  "token": "your_jwt_token", 
  "userId": "5f8e1b9b3f4e1a4c8f0b1a9" 
}
```

**失败响应 (401):**  
```json
{ "error": "Invalid email or password" }
```

---

**POST /api/auth/oauth/google**  
功能: 处理 Google OAuth 登录。后端与 Google 服务器交换授权码 (authorization code) 以获取用户信息。  

**请求体 (Body):**  
```json
{ "code": "google_auth_code_from_client" }
```

**成功响应 (200):**  
```json
{ 
  "token": "your_jwt_token", 
  "userId": "..." 
}
```

---

**POST /api/auth/oauth/github**  
功能: 处理 GitHub OAuth 登录。  

**请求体 (Body):**  
```json
{ "code": "github_auth_code_from_client" }
```

**成功响应 (200):**  
```json
{ 
  "token": "your_jwt_token", 
  "userId": "..." 
}
```

### 2.2 数据同步 (Data Synchronization)
**GET /api/bookmarks/all**  
功能: 在用户首次登录或需要全量同步时，获取该用户的所有书签数据。  

**认证:**  
`Authorization: Bearer <token>`

**成功响应 (200):**  
```json
[{...bookmark1...}, {...bookmark2...}]
```

**失败响应 (401):**  
```json
{ "error": "Unauthorized" }
```

---

**POST /api/bookmarks/sync**  
功能: 客户端处理完离线队列后，将多个变更一次性推送到服务器。这是实现“ID换证”的核心接口。  

**认证:**  
`Authorization: Bearer <token>`

**请求体 (Body):** 一个操作数组。  
- 对于 `add` 操作, payload 必须包含一个临时的 `clientId`，且不应包含 `_id`  
- 对于 `update` 或 `delete` 操作, payload 必须包含由服务器授予的权威 `_id`  

```json
[
  {
    "type": "add",
    "payload": { 
      "clientId": "2572f681-ac96-49e3-b217-b17c38f157a1", 
      "url": "https://new-bookmark.com", 
      "title": "A New Bookmark" 
    }
  },
  {
    "type": "update",
    "payload": { 
      "_id": "60f8e1b9b3f4e1a4c8f0b1c2", 
      "title": "Updated Title" 
    }
  },
  {
    "type": "delete",
    "payload": { 
      "_id": "60f8e1b9b3f4e1a4c8f0b1c3" 
    }
  }
]
```

**成功响应 (200):** 返回一个包含每项操作结果的数组。对于成功的 `add` 操作，响应将同时包含客户端的 `clientId` 和服务器生成的完整书签对象，以便客户端完成“换证”。  

```json
{
  "message": "Sync successful",
  "results": [
    {
      "operation": {
        "type": "add",
        "payload": { 
          "clientId": "2572f681-ac96-49e3-b217-b17c38f157a1", 
          "url": "https://new-bookmark.com", 
          "title": "A New Bookmark" 
        }
      },
      "status": "success",
      "data": {
        "_id": "60f8e1b9b3f4e1a4c8f0b1d5",
        "url": "https://new-bookmark.com",
        "title": "A New Bookmark",
        "dateAdded": "2025-08-07T05:51:00.000Z",
        "lastModified": "2025-08-07T05:51:00.000Z"
      }
    },
    {
      "operation": { 
        "type": "update", 
        "payload": { 
          "_id": "60f8e1b9b3f4e1a4c8f0b1c2", 
          "title": "Updated Title" 
        } 
      },
      "status": "success"
    }
  ]
}
```

> **注意:** 这个接口是 WebSocket 不可用时的备用方案，或者用于处理复杂的离线合并。

## 3. WebSocket API 接口设计 (用于实时增量同步)

### 3.1 客户端 -> 服务器 (Client-to-Server Events)
**Event: bookmark:add**  
功能: 添加一个新书签。  

**负载 (Payload):** `data` 对象必须包含一个由客户端生成的临时 `clientId`。`_id` 字段应省略。  

```json
{
  "operationId": "client_op_123",
  "data": {
    "clientId": "c1a7a72c-e36a-4b9b-8914-1e031b2f5b69",
    "url": "https://realtime-bookmark.com",
    "title": "Real-time Bookmark",
    "parentId": "folder_id_abc"
  }
}
```

---

**Event: bookmark:update**  
功能: 更新一个已存在的书签。  

**负载 (Payload):** `data` 必须包含 `_id` 和所有需要被修改的字段。此 `_id` 必须是由服务器授予的权威 ID。  

```json
{
  "operationId": "client_op_456",
  "data": {
    "_id": "60f8e1b9b3f4e1a4c8f0b1c2",
    "isStarred": true
  }
}
```

---

**Event: bookmark:delete**  
功能: 删除一个书签。  

**负载 (Payload):** `data` 必须包含被删除项的权威 `_id`。  

```json
{
  "operationId": "client_op_789",
  "data": {
    "_id": "bookmark_id_to_delete"
  }
}
```

### 3.2 服务器 -> 客户端 (Server-to-Client Events)
**Event: action:confirm**  
功能: 对客户端发起的某个操作进行成功确认。  

**负载 (Payload):** 对于添加操作，`data` 包含由服务器生成的完整对象，其中含有权威的 `_id`。  

```json
{
  "operationId": "client_op_123",
  "status": "success",
  "data": {
    "_id": "60f8e1b9b3f4e1a4c8f0b1d6",
    "clientId": "c1a7a72c-e36a-4b9b-8914-1e031b2f5b69",
    "url": "https://realtime-bookmark.com",
    "title": "Real-time Bookmark",
    "parentId": "folder_id_abc",
    "dateAdded": "...",
    "lastModified": "..."
  }
}
```

**客户端操作:**  
1. 使用 `operationId` 找到待处理的操作
2. 如果是 `add` 操作的确认，客户端需在本地数据中找到拥有对应 `clientId` 的临时书签，并用服务器返回的 `data` 对象（包含权威 `_id`）完全替换它（称为“换证”）
3. 将对应的操作从 `offlineQueue` 中移除

---

**Event: action:error**  
功能: 通知客户端某个操作处理失败。  

**负载 (Payload):**  
```json
{ 
  "operationId": "client_op_456", 
  "error": "Permission denied" 
}
```

---

**Event: broadcast:bookmark_added**  
功能: 广播给同一用户的其他客户端，通知有新书签被添加。  

**负载 (Payload):**  
```json
{...full_bookmark_object_with_real_id...}
```

**客户端操作:** 在本地数据和 UI 中添加这个新书签。

---

**Event: broadcast:bookmark_updated**  
功能: 广播一个书签被更新的事件。  

**负载 (Payload):**  
```json
{...full_bookmark_object...}
```

**客户端操作:** 根据 `_id` 找到本地书签并用新数据覆盖。

---

**Event: broadcast:bookmark_deleted**  
功能: 广播一个书签被删除的事件。  

**负载 (Payload):**  
```json
{ 
  "_id": "bookmark_id_that_was_deleted" 
}
```

**客户端操作:** 根据 `_id` 在本地数据和 UI 中移除该书签。

## 4. 错误处理
- 所有 REST API 响应都应使用标准的 HTTP 状态码（如 200, 201, 400, 401, 500）
- 错误响应体应包含清晰的错误消息：  
  ```json
  { "error": "Descriptive error message" }
  ```
- WebSocket 的错误通过 `action:error` 事件来传达