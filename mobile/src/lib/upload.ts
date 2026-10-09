import { File, UploadType } from "expo-file-system";
import { ORIGIN, api, tokens } from "@/lib/api";

/**
 * 上传照片。
 *
 * 走的还是「presign → 直传 → confirm」那套协议，但直传这一步在原生里
 * 不能用 fetch：媒体接口要的是**裸字节**（它会按字节嗅探真实图片类型），
 * 而 RN 的 fetch 传本地文件只能走 multipart。所以这里用 expo-file-system 的
 * createUploadTask + BINARY_CONTENT —— 它发的就是文件原始字节，和服务端预期一致。
 */
export async function uploadPhoto(localUri: string, contentType = "image/jpeg"): Promise<string> {
  const pre = await api.post<{ uploadUrl: string; objectKey: string }>("/users/me/photos/presign", {
    contentType,
  });

  const task = new File(localUri).createUploadTask(ORIGIN + pre.uploadUrl, {
    httpMethod: "PUT", // 媒体接口只挂了 PUT，POST 会 404
    uploadType: UploadType.BINARY_CONTENT, // 服务端要裸字节（按字节嗅探类型），不能发 multipart
    headers: {
      "Content-Type": contentType,
      // 媒体接口既认浏览器的读图 cookie，也认 Bearer（原生客户端用后者）
      Authorization: `Bearer ${tokens.access}`,
    },
  });
  const res = await task.uploadAsync();
  if (res.status !== 200) {
    throw new Error(res.status === 413 ? "图片不能超过 10MB" : "上传失败，请重试");
  }

  await api.post("/users/me/photos/confirm", { objectKey: pre.objectKey });
  return pre.objectKey;
}
