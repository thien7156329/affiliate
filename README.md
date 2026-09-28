# Affiliate MCP Server

MCP Server Node.js/TypeScript để handle flow: **Gemini/Veo → S3 → TikTok**

## Flow tổng quan

```
Google AI Ultra (Gemini Spark)
        │
        ▼
   Veo renders video → video URL
        │
        ▼
  MCP Server (port 3400)
  ┌─────────────────────────────┐
  │  upload_video(video_url)    │  ← download → upload S3
  │  save_metadata(s3_url, ...) │  ← lưu data/metadata.json
  │  publish_tiktok(s3_url)     │  ← mock hoặc real TikTok API
  └─────────────────────────────┘
```

## Cài đặt

```bash
cd affiliate
npm install
cp .env.example .env
# Điền AWS credentials vào .env
npm run dev
```

## Cấu hình .env

```env
PORT=3400
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
S3_BUCKET_NAME=your-bucket
S3_KEY_PREFIX=videos/

# mock (mặc định) hoặc real TikTok access token
TIKTOK_API_KEY=mock
```

## MCP Tools

| Tool | Input | Output |
|------|-------|--------|
| `upload_video` | `video_url`, `title`, `tags` | `s3_url`, `bucket`, `key`, `size_bytes` |
| `save_metadata` | `s3_url`, `source_url`, `title`, `tags`, `description` | `id`, `saved: true` |
| `publish_tiktok` | `s3_url`, `title`, `tags`, `metadata_id?` | `tiktok_video_id`, `status` |

## REST Endpoints

```
GET    /health             - Status server
GET    /api/videos         - Danh sách video (?page=1&limit=20)
GET    /api/videos/:id     - Chi tiết video
DELETE /api/videos/:id     - Xóa video
POST   /mcp                - MCP StreamableHTTP endpoint
```

## Kết nối với Gemini / Claude Desktop

Trong file cấu hình MCP của Gemini hoặc Claude:

```json
{
  "mcpServers": {
    "affiliate": {
      "type": "http",
      "url": "http://localhost:3400/mcp"
    }
  }
}
```

## Switch TikTok từ mock sang real

1. Đăng ký TikTok Developer account tại https://developers.tiktok.com
2. Tạo app, lấy OAuth2 Access Token
3. Set `TIKTOK_API_KEY=<access_token>` trong `.env`
4. Uncomment phần real API trong `publishToTikTok()` trong `src/server.ts`
# affiliate

## Multi-project local workspace bridge

The workspace bridge is a separate, localhost-only source browser and MCP server. It does not modify the affiliate pipeline server.

```bash
npm run dev:bridge
# Open http://127.0.0.1:3410
```

On first run it registers this repository. Use **+ Project** in the browser to add more absolute project folders. Removing a project only removes it from the registry; it never deletes source files.

MCP endpoint:

```toml
[mcp_servers.localWorkspace]
url = "http://127.0.0.1:3410/mcp"
```

Available tools: `list_projects`, `list_files`, `read_file`, `write_file`, and `search_code`. Reads and writes are confined to registered roots, symlinks are excluded from discovery, file size is limited, and saves use an optional ETag to prevent overwriting concurrent edits.

Keep the default `127.0.0.1` host for local use. If the server is exposed through HTTPS, set `WORKSPACE_BRIDGE_TOKEN` and send it as a Bearer token.

For an HTTPS tunnel, also set `WORKSPACE_BRIDGE_PUBLIC=true`. Public mode always requires the Bearer token and exposes only `/mcp` plus the non-sensitive `/health` probe; browser and REST workspace routes return `404`.
