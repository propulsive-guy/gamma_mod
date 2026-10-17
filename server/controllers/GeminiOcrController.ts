import { Request, Response } from 'express';
import { decodeImagePayload, extractWithGemini } from '../services/GeminiOcrService';

export class GeminiOcrController {
    static async extractInventory(req: Request, res: Response) {
        return GeminiOcrController.extract(req, res, 'inventory');
    }

    static async extractMenu(req: Request, res: Response) {
        return GeminiOcrController.extract(req, res, 'menu');
    }

    private static async extract(req: Request, res: Response, task: 'inventory' | 'menu') {
        if (!req.user?.restaurantId) return res.status(401).json({ success: false, error: 'Please sign in again.' });
        const image = decodeImagePayload(req.body?.imageBase64);
        if (!image) return res.status(400).json({ success: false, error: 'Image data is missing, invalid, or larger than 4 MB.' });
        const mimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType : '';
        try {
            const result = await extractWithGemini(task, image, mimeType);
            return res.status(result.success ? 200 : 422).json(result);
        } catch (error) {
            console.error('Gemini extraction controller error:', error);
            return res.status(500).json({ success: false, error: 'Bill reading failed on the API server. Check the server logs and retry.' });
        }
    }
}
