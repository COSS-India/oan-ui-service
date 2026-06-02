import axios from 'axios';

// ---- Interfaces ----

export interface CropItem {
  crop_id: number;
  crop_name: string;
  crop_name_mr?: string;
  crop_name_hi?: string;
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
const PEST_FEEDBACK_API_BASE = 'https://farmers-app-api.mahapocra.gov.in';

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
 * Get available crops for pest detection dropdown.
 * API returns { status, data: [{ id, name, name_mr?, name_hi? }, ...] }.
 */
export async function getCrops(): Promise<CropItem[]> {
  const response = await axios.get(
    `${PEST_API_BASE}/pestdetectionServices/get-crops-for-pest-detection`
  );
  const crops = asArray<CropApiItem>(response.data)
    .map(normalizeCrop)
    .filter((crop): crop is CropItem => crop !== null);

  return crops;
}

/**
 * Store user feedback for a pest detection response (upload id from /api/upload/).
 */
export async function storePestFeedback(
  uploadId: string,
  feedback: string
): Promise<unknown> {
  const formData = new FormData();
  formData.append('id', uploadId.trim());
  formData.append('feedback', feedback.trim());

  const response = await axios.post(
    `${PEST_FEEDBACK_API_BASE}/pestdetectionServices/store-feedback`,
    formData
  );
  return response.data;
}