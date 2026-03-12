import axios from 'axios';

// ---- Interfaces ----

export interface CropItem {
  crop_id: number;
  crop_name: string;
  crop_name_mr?: string;
  crop_name_hi?: string;
}

export interface PredictionEntry {
  disease_type: string;
  disease_id: string;
  confidence_score: number;
}

export interface PredictionResult {
  success: boolean;
  message: string;
  data: {
    crop_id: number;
    crop_type: string;
    sowing_date: string;
    predictions: PredictionEntry[];
    created_at: string;
  };
}

export interface AdvisoryResult {
  preventive_measures: string;
  curative_measures: string;
  [key: string]: unknown;
}

interface PestCropApiItem {
  id: number;
  name: string;
  name_mr?: string;
  name_hi?: string;
}

interface PestCropApiEnvelope {
  status: number;
  response: string;
  data: PestCropApiItem[];
}

// ---- API Base URLs ----

const PEST_API_BASE = 'https://stage-farmers-app-api.mahapocra.gov.in';
const PREDICT_API_BASE = 'https://ndksp-tih.mahapocra.gov.in';

// ---- Fallback Crops (used when API is unavailable) ----

export const FALLBACK_CROPS: CropItem[] = [
  { crop_id: 67, crop_name: 'Kharif Maize' },
  { crop_id: 86, crop_name: 'Paddy' },
  { crop_id: 70, crop_name: 'Wheat' },
  { crop_id: 68, crop_name: 'Kharif Sorghum' },
  { crop_id: 58, crop_name: 'Gram' },
  { crop_id: 33, crop_name: 'Pigeon pea (Tur)' },
  { crop_id: 74, crop_name: 'Groundnut' },
  { crop_id: 30, crop_name: 'Soybean' },
  { crop_id: 97, crop_name: 'Mustard' },
  { crop_id: 8, crop_name: 'Sugarcane (Adsali)' },
  { crop_id: 25, crop_name: 'Cotton' },
  { crop_id: 7, crop_name: 'Potato' },
  { crop_id: 39, crop_name: 'Veg- Onion' },
  { crop_id: 42, crop_name: 'Veg- Tomato ' },
  { crop_id: 3, crop_name: 'Brinjal' },
  { crop_id: 183, crop_name: 'Apple' },
  { crop_id: 48, crop_name: 'Mango' },
];

// ---- Service Functions ----

/**
 * Step 1: Get available crops for pest detection dropdown
 */
export async function getCrops(): Promise<CropItem[]> {
  const response = await axios.get(
    `${PEST_API_BASE}/pestdetectionServices/get-crops-for-pest-detection`
  );

  // Supports both legacy array response and current envelope response.
  const payload = response.data as PestCropApiEnvelope | PestCropApiItem[] | null | undefined;
  const crops = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : [];

  return crops.map((crop) => ({
    crop_id: crop.id,
    crop_name: crop.name,
    crop_name_mr: crop.name_mr,
    crop_name_hi: crop.name_hi,
  }));
}

/**
 * Step 2: Submit image + metadata to the prediction engine
 */
export async function predictDisease(
  cropType: string,
  sowingDate: string,
  image: File,
  cropId: string
): Promise<PredictionResult> {
  const formData = new FormData();
  formData.append('crop_type', cropType.trim());
  formData.append('sowing_date', sowingDate);
  // Explicit filename helps backends that infer file type from multipart filename.
  formData.append('image', image, image.name || 'crop-image.jpg');
  formData.append('crop_id', cropId.trim());

  try {
    // Let the browser set multipart boundary automatically.
    const response = await axios.post(`${PREDICT_API_BASE}/api/v1/predict`, formData);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const backendMessage =
        typeof error.response?.data === 'string'
          ? error.response.data
          : JSON.stringify(error.response?.data ?? {});
      throw new Error(
        `Predict API failed (${error.response?.status ?? 'unknown'}): ${backendMessage}`
      );
    }
    throw error;
  }
}

/**
 * Step 3: Get advisory (preventive & curative measures) for a disease
 */
export async function getAdvisory(pdId: string): Promise<AdvisoryResult> {
  const formData = new FormData();
  formData.append('pd_id', pdId);

  const response = await axios.post(
    `${PEST_API_BASE}/pestdetectionServices/crop_pd_advisory`,
    formData
  );
  return response.data;
}

/**
 * Step 4: Store the prediction + image for analytics
 */
export async function storeResponse(
  image: File,
  cropId: string,
  sowingDate: string,
  isSuccess: boolean,
  response: string,
  userId: string,
  pdId: string
): Promise<unknown> {
  const formData = new FormData();
  formData.append('image', image);
  formData.append('crop_id', cropId);
  formData.append('sowing_date', sowingDate);
  formData.append('is_success', String(isSuccess));
  formData.append('response', response);
  formData.append('user_id', userId);
  formData.append('pd_id', pdId);

  const res = await axios.post(
    `${PEST_API_BASE}/pestdetectionServices/store-response-against-crop-image`,
    formData
  );
  return res.data;
}
