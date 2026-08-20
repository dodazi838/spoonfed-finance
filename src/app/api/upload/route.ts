import { NextRequest, NextResponse } from 'next/server';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다.' }, { status: 500 });
    }

    // ─── 1. 업로드 시작 (Start Upload Session) ───
    if (contentType.includes('application/json')) {
      const { action } = await req.json();

      if (action === 'start') {
        const uploadId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const tempFilePath = path.join(os.tmpdir(), `upload_${uploadId}.pdf`);
        
        // 초기 빈 파일 생성
        await fs.writeFile(tempFilePath, Buffer.alloc(0));

        return NextResponse.json({ success: true, uploadId });
      }

      return NextResponse.json({ error: '잘못된 액션 요청입니다.' }, { status: 400 });
    }

    // ─── 2. 청크 수신 및 조립 (Append Chunk & Upload to Google) ───
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const uploadId = formData.get('uploadId') as string;
      const isFinal = formData.get('isFinal') === 'true';
      const fileName = (formData.get('fileName') as string) || 'document.pdf';
      const mimeType = (formData.get('mimeType') as string) || 'application/pdf';
      const chunk = formData.get('chunk') as File;

      if (!uploadId || !chunk) {
        return NextResponse.json(
          { error: '필수 파라미터(uploadId, chunk)가 누락되었습니다.' },
          { status: 400 }
        );
      }

      const tempFilePath = path.join(os.tmpdir(), `upload_${uploadId}.pdf`);
      const chunkBytes = await chunk.arrayBuffer();
      const chunkBuffer = Buffer.from(chunkBytes);

      // 청크 데이터를 임시 파일에 누적(append)
      await fs.appendFile(tempFilePath, chunkBuffer);

      // 마지막 청크인 경우: Google AI File API로 원본 전송
      if (isFinal) {
        try {
          const fileManager = new GoogleAIFileManager(apiKey);
          const uploadResult = await fileManager.uploadFile(tempFilePath, {
            mimeType: mimeType,
            displayName: fileName,
          });

          // 임시 파일 정리
          await fs.unlink(tempFilePath).catch(console.error);

          return NextResponse.json({
            success: true,
            isFinal: true,
            fileUri: uploadResult.file.uri,
            mimeType: uploadResult.file.mimeType || mimeType,
            displayName: uploadResult.file.displayName,
          });
        } catch (uploadErr: any) {
          await fs.unlink(tempFilePath).catch(console.error);
          console.error('Google File API Upload Error:', uploadErr);
          return NextResponse.json(
            { error: `구글 서버 업로드 실패: ${uploadErr.message || '알 수 없는 오류'}` },
            { status: 500 }
          );
        }
      }

      // 중간 청크 수신 성공
      return NextResponse.json({
        success: true,
        isFinal: false,
      });
    }

    return NextResponse.json({ error: '지원하지 않는 Content-Type입니다.' }, { status: 400 });
  } catch (error: any) {
    console.error('Upload Relay Error:', error);
    return NextResponse.json(
      { error: error.message || '업로드 중 알 수 없는 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
