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
  disease_pest?: string;
  disease_pest_mr?: string;
  disease_pest_hi?: string;
  preventive_measures: string;
  preventive_measures_mr?: string;
  preventive_measures_hi?: string;
  curative_measures: string;
  curative_measures_mr?: string;
  curative_measures_hi?: string;
  note?: string;
  [key: string]: unknown;
}

interface CropApiItem {
  id?: number | string;
  crop_id?: number | string;
  name?: string;
  crop_name?: string;
  name_mr?: string;
  crop_name_mr?: string;
  name_hi?: string;
  crop_name_hi?: string;
}

// ---- API Base URLs ----

const PEST_API_BASE = 'https://stage-farmers-app-api.mahapocra.gov.in';
const PREDICT_API_BASE = 'https://ndksp-tih.mahapocra.gov.in';

const asArray = <T>(payload: unknown): T[] => {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: T[] }).data;
  }
  return [];
};

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const toString = (value: unknown): string | undefined => {
  return typeof value === 'string' ? value : undefined;
};

const normalizeCrop = (item: CropApiItem): CropItem | null => {
  const cropId = toNumber(item.crop_id ?? item.id);
  const cropName = toString(item.crop_name ?? item.name);
  if (cropId === undefined || !cropName) return null;

  return {
    crop_id: cropId,
    crop_name: cropName,
    crop_name_mr: toString(item.crop_name_mr ?? item.name_mr),
    crop_name_hi: toString(item.crop_name_hi ?? item.name_hi),
  };
};

// ---- Fallback Crops (used when API is unavailable) ----

export const FALLBACK_CROPS: CropItem[] = [
  { crop_id: 1, crop_name: 'Maize' },
  { crop_id: 2, crop_name: 'Paddy' },
  { crop_id: 3, crop_name: 'Wheat' },
  { crop_id: 4, crop_name: 'Sorghum' },
  { crop_id: 5, crop_name: 'Gram' },
  { crop_id: 6, crop_name: 'Pigeon pea (Tur)' },
  { crop_id: 7, crop_name: 'Groundnut' },
  { crop_id: 8, crop_name: 'Soybean' },
  { crop_id: 9, crop_name: 'Mustard' },
  { crop_id: 10, crop_name: 'Sugarcane' },
  { crop_id: 11, crop_name: 'Cotton' },
  { crop_id: 12, crop_name: 'Potato' },
  { crop_id: 13, crop_name: 'Onion' },
  { crop_id: 14, crop_name: 'Tomato' },
  { crop_id: 15, crop_name: 'Brinjal' },
  { crop_id: 16, crop_name: 'Grapes' },
  { crop_id: 17, crop_name: 'Apple' },
  { crop_id: 18, crop_name: 'Mango' },
];

// ---- Service Functions ----

/**
 * Step 1: Get available crops for pest detection dropdown
 */
export async function getCrops(): Promise<CropItem[]> {
  const response = await axios.get(
    `${PEST_API_BASE}/pestdetectionServices/get-crops-for-pest-detection`
  );
  return asArray<CropApiItem>(response.data)
    .map(normalizeCrop)
    .filter((crop): crop is CropItem => crop !== null);
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
  formData.append('crop_type', cropType);
  formData.append('sowing_date', sowingDate);
  formData.append('image', image);
  formData.append('crop_id', cropId);

  const response = await axios.post(
    `${PREDICT_API_BASE}/api/v1/predict`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return response.data;
}

/**
 * Step 3: Get advisory (preventive & curative measures) for a disease
 */
export async function getAdvisory(pdId: string): Promise<AdvisoryResult> {
  const formData = new FormData();
  formData.append('pd_id', pdId);

  const response = await axios.post(
    `${PEST_API_BASE}/pestdetectionServices/crop_pd_advisory`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  const payload = response.data;
  const fallback: AdvisoryResult = {
    preventive_measures: "",
    curative_measures: "",
  };

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const directPayload = payload as Partial<AdvisoryResult>;
    if (
      typeof directPayload.preventive_measures === 'string' ||
      typeof directPayload.curative_measures === 'string'
    ) {
      return {
        ...directPayload,
        preventive_measures: toString(directPayload.preventive_measures) ?? "",
        curative_measures: toString(directPayload.curative_measures) ?? "",
      };
    }
  }

  const advisoryList = asArray<Partial<AdvisoryResult>>(payload);
  const firstAdvisory = advisoryList[0];

  if (!firstAdvisory) return fallback;

  return {
    ...firstAdvisory,
    preventive_measures: toString(firstAdvisory.preventive_measures) ?? "",
    curative_measures: toString(firstAdvisory.curative_measures) ?? "",
  };
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
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return res.data;
}
