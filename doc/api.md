# 基于 MongoDB 的通讯接口设计 (扩展认证)

### 1. 统一数据模型与认证

#### 1.1 数据模型 (Data Model)

所有**完整的**书签对象都应遵循统一的 JSON 格式。在不同的接口和事件中，可能会根据操作需要传输对象的**部分字段**。一个完整的书签对象包含以下关键字段：

```json
{
  "_id": "60f8e1b9b3f4e1a4c8f0b1c2",
  "userId": "5f8e1b9b3f4e1a4c8f0b1a9",
  "url": "[https://example.com](https://example.com)",
  "title": "示例标题",
  "summary": "这是书签的摘要...",
  "tags": ["技术", "参考"],
  "notes": "这是一些笔记内容。",
  "isStarred": false,
  "isDeleted": false,
  "type": "bookmark",
  "parentId": "root",
  "dateAdded": "2025-07-22T18:00:00.000Z",
  "lastModified": "2025-07-22T18:30:00.000Z"
}
```

#### 1.2 认证方式 (Authentication)

* 所有需要用户身份的 API 请求，都必须在 HTTP Header 中携带 **JSON Web Token (JWT)**。
    * **Header 格式**: `Authorization: Bearer <your_jwt_token>`
* WebSocket 连接在建立时，也需要在连接参数中传递 JWT，以便服务器识别用户身份并将其与对应的 socket 连接关联起来。

---

### 2. RESTful API 接口设计 (用于认证和初始数据)

#### 2.1 用户认证 (Authentication)

* **POST** `/api/auth/register`
    * **功能**: 用户邮箱/密码注册。
    * **请求体 (Body)**: `{ "email": "user@example.com", "password": "a_strong_password" }`
    * **成功响应 (201)**: `{ "message": "User registered successfully" }`
    * **失败响应 (409)**: `{ "error": "Email already exists" }`

* **POST** `/api/auth/login`
    * **功能**: 用户邮箱/密码登录。
    * **请求体 (Body)**: `{ "email": "user@example.com", "password": "a_strong_password" }`
    * **成功响应 (200)**: `{ "token": "your_jwt_token", "userId": "5f8e1b9b3f4e1a4c8f0b1a9" }`
    * **失败响应 (401)**: `{ "error": "Invalid email or password" }`

* **POST** `/api/auth/oauth/google`
    * **功能**: 处理 Google OAuth 登录。后端与 Google 服务器交换授权码 (authorization code) 以获取用户信息。
    * **请求体 (Body)**: `{ "code": "google_auth_code_from_client" }`
    * **成功响应 (200)**: `{ "token": "your_jwt_token", "userId": "..." }`

* **POST** `/api/auth/oauth/github`
    * **功能**: 处理 GitHub OAuth 登录。
    * **请求体 (Body)**: `{ "code": "github_auth_code_from_client" }`
    * **成功响应 (200)**: `{ "token": "your_jwt_token", "userId": "..." }`

* **POST** `/api/auth/oauth/facebook`
    * **功能**: 处理 Facebook OAuth 登录。
    * **请求体 (Body)**: `{ "code": "facebook_auth_code_from_client" }`
    * **成功响应 (200)**: `{ "token": "your_jwt_token", "userId": "..." }`

* **POST** `/api/auth/oauth/wechat`
    * **功能**: 处理微信 OAuth 登录（通常是网站扫码登录）。
    * **请求体 (Body)**: `{ "code": "wechat_auth_code_from_client" }`
    * **成功响应 (200)**: `{ "token": "your_jwt_token", "userId": "..." }`
    * **注意**: 微信登录流程与其他几家略有不同，但最终目的都是客户端获取一个临时 `code`，交由后端换取用户信息和生成平台自己的 `token`。

#### 2.2 数据同步 (Data Synchronization)

* **GET** `/api/bookmarks/all`
    * **功能**: 在用户首次登录或需要全量同步时，获取该用户的所有书签数据。
    * **认证**: `Authorization: Bearer <token>`
    * **成功响应 (200)**: `[{...bookmark1...}, {...bookmark2...}]`
    * **失败响应 (401)**: `{ "error": "Unauthorized" }`

* **POST** `/api/bookmarks/sync`
    * **功能**: 客户端处理完离线队列后，将多个变更一次性推送到服务器。
    * **认证**: `Authorization: Bearer <token>`
    * **请求体 (Body)**: `[{ "type": "add", "payload": {...} }, { "type": "delete", "payload": { "_id": "..." } }]`
    * **成功响应 (200)**: `{ "message": "Sync successful", "results": [...] }`
    * **注意**: 这个接口是 WebSocket 不可用时的备用方案，或者用于处理复杂的离线合并。

---

### 3. WebSocket API 接口设计 (用于实时增量同步)

#### 3.1 客户端 -> 服务器 (Client-to-Server Events)

* **Event**: `bookmark:add`
    * **功能**: 添加一个新书签。
    * **负载 (Payload)**: `{ "operationId": "unique_id_123", "data": { "url": "...", "title": "...", "parentId": "..." } }` (包含客户端能提供的所有初始数据)

* **Event**: `bookmark:update`
    * **功能**: 更新一个已存在的书签。
    * **负载 (Payload)**: `{ "operationId": "unique_id_456", "data": { "_id": "...", "title": "New Title" } }` (包含 `_id` 和所有需要被修改的字段)

* **Event**: `bookmark:delete`
    * **功能**: 删除一个书签。
    * **负载 (Payload)**: `{ "operationId": "unique_id_789", "data": { "_id": "bookmark_id_to_delete" } }` (只需包含被删除项的 `_id`)

#### 3.2 服务器 -> 客户端 (Server-to-Client Events)

* **Event**: `action:confirm`
    * **功能**: 对客户端发起的某个操作进行成功确认。
    * **负载 (Payload)**: `{ "operationId": "unique_id_123", "status": "success", "data": {...full_bookmark_object...} }` (对于添加操作，`data` 包含由服务器生成的完整对象)
    * **客户端操作**: 收到此事件后，将对应的操作从 `offlineQueue` 中移除。

* **Event**: `action:error`
    * **功能**: 通知客户端某个操作处理失败。
    * **负载 (Payload)**: `{ "operationId": "unique_id_456", "error": "Permission denied" }`

* **Event**: `broadcast:bookmark_added`
    * **功能**: 广播给同一用户的其他客户端，通知有新书签被添加。
    * **负载 (Payload)**: `{...full_bookmark_object...}`
    * **客户端操作**: 在本地数据和 UI 中添加这个新书签。

* **Event**: `broadcast:bookmark_updated`
    * **功能**: 广播一个书签被更新的事件。
    * **负载 (Payload)**: `{...full_bookmark_object...}`
    * **客户端操作**: 根据 `_id` 找到本地书签并用新数据覆盖。

* **Event**: `broadcast:bookmark_deleted`
    * **功能**: 广播一个书签被删除的事件。
    * **负载 (Payload)**: `{ "_id": "bookmark_id_that_was_deleted" }`
    * **客户端操作**: 根据 `_id` 在本地数据和 UI 中移除该书签。

---

### 4. 错误处理

* 所有 **REST API** 响应都应使用标准的 HTTP 状态码（如 200, 201, 400, 401, 500）。
* 错误响应体应包含一个清晰的错误消息：`{ "error": "Descriptive error message" }`。
* **WebSocket** 的错误通过 `action:error` 事件来传达。
