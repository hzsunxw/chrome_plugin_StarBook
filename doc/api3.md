# 基于 MongoDB 的统一项目同步接口设计

## 1. 核心设计思想
本接口设计的核心是统一性和健壮性。无论是书签（bookmark）还是文件夹（folder），都被抽象为统一的**“项目 (Item)”**。所有项目共享一套数据模型和一套同步接口，从而简化了客户端逻辑，并确保了数据在多设备间的强一致性。

## 2. 数据模型 (Data Model)
### 2.1 统一项目 (Item) 结构
所有项目，无论类型，都遵循统一的JSON格式。通过type字段来区分其具体类型。

**通用关键字段**:
- `_id` (String): MongoDB生成的唯一永久ID，同步后所有项目都拥有
- `userId` (String): 所属用户的ID
- `title` (String): 项目的标题（书签或文件夹名称）
- `type` (String): 项目类型，必须为 "bookmark" 或 "folder"
- `parentId` (String): 父项目的 _id。根目录的父ID为 "root"
- `isStarred` (Boolean): 是否已收藏
- `notes` (String): 用户笔记
- `dateAdded` (ISODate): 创建日期
- `lastModified` (ISODate): 最后修改日期

**书签对象示例 (Bookmark Object Example)**:  
一个 type 为 "bookmark" 的项目，包含额外的URL相关字段。

```json
{
  "_id": "60f8e1b9b3f4e1a4c8f0b1c2",
  "userId": "5f8e1b9b3f4e1a4c8f0b1a9",
  "url": "https://example.com/some-article",
  "title": "一篇关于API设计的文章",
  "summary": "这是由AI生成的书签摘要...",
  "tags": ["技术", "API设计", "后端"],
  "aiStatus": "pending",
  "notes": "这篇文章非常值得一读。",
  "contentType": "article",
  "estimatedReadTime": 10,
  "readingLevel": "intermediate",
  "isStarred": true,
  "isDeleted": false,
 "type": "bookmark",
  "parentId": "folder_id_abc",
  "dateAdded": "2025-08-07T05:51:00.000Z",
  "lastModified": "2025-08-07T05:55:00.000Z"
}
```

**文件夹对象示例 (Folder Object Example)**:  
一个 type 为 "folder" 的项目，结构更简洁。

```json
{
  "_id": "folder_id_abc",
  "userId": "5f8e1b9b3f4e1a4c8f0b1a9",
  "title": "技术参考资料",
  "notes": "存放所有关于技术的书签和文件夹。",
  "isStarred": false,
  "isDeleted": false,
  "type": "folder",
  "parentId": "root",
  "dateAdded": "2025-08-07T05:50:00.000Z",
  "lastModified": "2025-08-07T05:50:00.000Z"
}
```

### 2.2 关于ID的重要说明
- `_id` (服务器ID): 由服务器MongoDB生成，全局唯一且永久。所有更新和删除操作都必须使用 _id 作为凭证
- `clientId` (客户端ID): 当客户端在本地（离线）创建一个新项目时，必须为其生成一个临时的、唯一的ID（推荐使用UUID）。clientId 的唯一作用是在该项目成功同步到服务器并获得永久 _id 之前，用于在本地进行追踪和关联（例如，将一个新书签放入一个新文件夹）。服务器不存储 clientId

## 3. 认证 (Authentication)
所有需要用户身份验证的API请求，都必须在HTTP Header中携带通过登录获取的JWT。

**Header格式**:  
`Authorization: Bearer <your_jwt_token>`

## 4. RESTful API (用于初始同步和批量操作)
### 4.1 用户认证接口
**POST /api/auth/register**  
功能: 使用邮箱和密码注册新用户。

**请求体 (Body)**:
```json
{
  "email": "user@example.com",
  "password": "a_strong_password"
}
```

**成功响应 (201)**:
```json
{
  "message": "User registered successfully"
}
```

**失败响应 (409 Conflict)**: Email已被注册。
```json
{
  "error": "Email already exists"
}
```

**POST /api/auth/login**  
功能: 用户使用邮箱和密码登录，获取JWT。

**请求体 (Body)**:
```json
{
  "email": "user@example.com",
  "password": "a_strong_password"
}
```

**成功响应 (200)**:
```json
{
  "token": "your_jwt_token",
  "userId": "5f8e1b9b3f4e1a4c8f0b1a9",
  "email": "user@example.com"
}
```

**失败响应 (401 Unauthorized)**: 邮箱或密码错误。
```json
{
  "error": "Invalid email or password"
}
```

**POST /api/auth/oauth/google**  
功能: 处理第三方（以Google为例）OAuth登录。客户端从Google获取授权码(authorization code)后，发送给后端以完成验证并获取JWT。

**请求体 (Body)**:
```json
{
  "code": "google_auth_code_from_client"
}
```

**成功响应 (200)**:
```json
{
  "token": "your_jwt_token",
  "userId": "google_user_id_xxxx",
  "email": "user.from.google@gmail.com"
}
```

**失败响应 (401 Unauthorized)**: 授权码无效或验证失败。
```json
{
  "error": "Invalid authorization code"
}
```

### 4.2 数据同步接口
**GET /api/items/all**  
功能: 全量获取。在用户首次登录或需要强制刷新时，一次性获取该用户的所有项目数据（包括所有书签和文件夹）。

认证: `Authorization: Bearer <token>`

**成功响应 (200)**: 一个包含用户所有项目对象的数组。客户端接收到这个数组后，可以在本地重建完整的目录树结构。
```json
[
  { "_id": "folder_id_abc", "type": "folder", ... },
  { "_id": "60f8e1b9b3f4e1a4c8f0b1c2", "type": "bookmark", "parentId": "folder_id_abc", ... },
  { "_id": "folder_id_xyz", "type": "folder", ... }
]
```

**POST /api/items/sync**  
功能: 批量变更。这是实现离线操作同步和保证数据最终一致性的核心接口。客户端可以将本地积累的多个变更（增、删、改）一次性推送到服务器。

认证: `Authorization: Bearer <token>`

**请求体 (Body)**: 一个操作(operation)数组。每个操作对象包含 type (操作类型) 和 payload (数据负载)。
- add 操作的 payload 必须 包含 clientId 和 type
- update 和 delete 操作的 payload 必须 包含 _id

```json
[
  {
    "type": "add",
    "payload": {
      "clientId": "client_folder_id_01",
      "title": "我的新文件夹",
      "type": "folder",
      "parentId": "root"
    }
  },
  {
    "type": "add",
    "payload": {
      "clientId": "client_bookmark_id_01",
      "url": "https://new-bookmark.com",
      "title": "一篇很棒的新书签",
      "type": "bookmark",
      "parentId": "client_folder_id_01"
    }
  },
  {
    "type": "update",
    "payload": {
      "_id": "server_item_id_02",
      "title": "更新后的文件夹标题"
    }
  },
  {
    "type": "delete",
    "payload": {
      "_id": "server_item_id_03"
    }
  }
]
```

**成功响应 (200)**: 返回一个包含每项操作结果的数组。  
对于成功的 add 操作，响应中会包含服务器生成的完整项目对象（带有 _id），客户端必须用它来替换本地的临时项目，完成“ID换证”。

```json
{
  "message": "Sync successful",
  "results": [
    {
      "operation": { "type": "add", "payload": { "clientId": "client_folder_id_01", ... } },
      "status": "success",
      "data": { "_id": "server_folder_id_new", "type": "folder", ... }
    },
    {
      "operation": { "type": "update", ... },
      "status": "success"
    }
  ]
}
```

## 5. WebSocket API (用于实时增量同步)
WebSocket用于在用户在线时，实时、双向地同步单个项目的变更，提供流畅的多设备体验。

### 5.1 客户端 -> 服务器 (Client-to-Server Events)
**Event: item:add**  
功能: 实时添加一个新项目。  
负载: data 对象必须包含 clientId 和 type

**Event: item:update**  
功能: 实时更新一个已存在的项目。  
负载: data 对象必须包含 _id 和需要更新的字段

**Event: item:delete**  
功能: 实时删除一个项目。  
负载: data 对象必须包含 _id

### 5.2 服务器 -> 客户端 (Server-to-Client Events)
**Event: action:confirm**  
功能: 对客户端发起的某个操作进行成功确认。对于 item:add 的确认，data 中会包含新项目的完整对象（含 _id），用于客户端进行“ID换证”

**Event: action:error**  
功能: 通知客户端某个操作处理失败，并附带错误信息

**Event: broadcast:item_added**  
功能: 广播给发起方之外的其他客户端，通知有新项目被添加  
负载: 完整的项目对象

**Event: broadcast:item_updated**  
功能: 广播一个项目被更新的事件  
负载: 完整的项目对象

**Event: broadcast:item_deleted**  
功能: 广播一个项目被删除的事件  
负载: `{ "_id": "item_id_that_was_deleted" }`  
客户端操作: 客户端收到此事件后，需根据 _id 在本地移除该项目。如果被删除的是文件夹，客户端有责任递归删除其下的所有子项目，以保持UI的一致性
