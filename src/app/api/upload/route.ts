import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다.' }, { status: 500 });
    }

    // ─── 1. 업로드 시작 (Start Resumable Session) ───
    if (contentType.includes('application/json')) {
      const { action, fileName, fileSize, mimeType } = await req.json();

      if (action === 'start') {
        const startRes = await fetch(
          `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
          {
            method: 'POST',
            headers: {
              'X-Goog-Upload-Protocol': 'resumable',
              'X-Goog-Upload-Command': 'start',
              'X-Goog-Upload-Header-Content-Length': String(fileSize),
              'X-Goog-Upload-Header-Content-Type': mimeType || 'application/pdf',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              file: {
                display_name: fileName || 'document.pdf',
              },
            }),
          }
        );

        if (!startRes.ok) {
          const errText = await startRes.text();
          console.error('Google File API Start Error:', errText);
          return NextResponse.json(
            { error: `구글 파일 업로드 세션 생성 실패: ${startRes.statusText}` },
            { status: startRes.status }
          );
        }

        const uploadUrl = startRes.headers.get('x-goog-upload-url') || startRes.headers.get('X-Goog-Upload-URL');

        if (!uploadUrl) {
          return NextResponse.json(
            { error: '구글 업로드 URL을 받지 못했습니다.' },
            { status: 500 }
          );
        }

        return NextResponse.json({ success: true, uploadUrl });
      }

      return NextResponse.json({ error: '잘못된 액션 요청입니다.' }, { status: 400 });
    }

    // ─── 2. 청크 릴레이 전송 (Upload Chunk) ───
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const uploadUrl = formData.get('uploadUrl') as string;
      const offsetStr = formData.get('offset') as string;
      const isFinal = formData.get('isFinal') === 'true';
      const chunk = formData.get('chunk') as File;

      if (!uploadUrl || !offsetStr || !chunk) {
        return NextResponse.json(
          { error: '필수 파라미터(uploadUrl, offset, chunk)가 누락되었습니다.' },
          { status: 400 }
        );
      }

      const offset = parseInt(offsetStr, 10);
      const chunkBytes = await chunk.arrayBuffer();
      const chunkSize = chunkBytes.byteLength;

      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Offset': String(offset),
          'X-Goog-Upload-Command': isFinal ? 'upload, finalize' : 'upload',
          'Content-Length': String(chunkSize),
        },
        body: chunkBytes,
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        console.error('Google File API Chunk Upload Error:', errText);
        return NextResponse.json(
          { error: `청크 업로드 실패: ${uploadRes.statusText}` },
          { status: uploadRes.status }
        );
      }

      if (isFinal) {
        const finalData = await uploadRes.json();
        const fileInfo = finalData.file;

        return NextResponse.json({
          success: true,
          isFinal: true,
          fileUri: fileInfo.uri,
          mimeType: fileInfo.mimeType,
          displayName: fileInfo.displayName,
        });
      }

      return NextResponse.json({
        success: true,
        isFinal: false,
        uploadedBytes: offset + chunkSize,
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
