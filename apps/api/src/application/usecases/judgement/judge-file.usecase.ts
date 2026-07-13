import { SkillJudgerPort } from '../../ports/outbound/judger.port';
import { FileScannerPort } from '../../ports/outbound/file-scanner.port';

export class JudgeFileUseCase {
  constructor(
    private readonly scanner: FileScannerPort,
    private readonly judger: SkillJudgerPort
  ) {}

  async execute(file: { content: Buffer; mimeType: string; fileName: string }) {
    const scanned = await this.scanner.scan(file.content, file.mimeType, file.fileName);
    return this.judger.judge({
      type: 'file',
      id: file.fileName,
      title: file.fileName,
      text: scanned.text,
      metadata: {
        mimeType: file.mimeType,
        fileName: file.fileName,
        extractedBy: scanned.extractedBy,
      },
    });
  }
}
