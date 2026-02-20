import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, ImageIcon, X, Loader2 } from "lucide-react";
import { getCrops, FALLBACK_CROPS, type CropItem } from "@/lib/pest-detection-api";
import { useLanguage } from "@/components/LanguageProvider";
import { toast } from "@/hooks/use-toast";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/jpg"];

interface PestDetectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (cropId: string, cropName: string, sowingDate: string, image: File) => void;
  isSubmitting?: boolean;
}

export function PestDetectionDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting = false,
}: PestDetectionDialogProps) {
  const { t } = useLanguage();
  const [crops, setCrops] = useState<CropItem[]>([]);
  const [loadingCrops, setLoadingCrops] = useState(false);
  const [selectedCropId, setSelectedCropId] = useState<string>("");
  const [sowingDate, setSowingDate] = useState<string>("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Fetch crops on dialog open
  useEffect(() => {
    if (open && crops.length === 0) {
      setLoadingCrops(true);
      getCrops()
        .then((data) => setCrops(data))
        .catch((err) => {
          console.error("Failed to fetch crops, using fallback list:", err);
          // Load fallback crops from translation JSON
          const translationCrops = t("pestDetection.crops") as unknown;
          if (Array.isArray(translationCrops) && translationCrops.length > 0) {
            setCrops(
              (translationCrops as { id: number; name: string }[]).map((c) => ({
                crop_id: c.id,
                crop_name: c.name,
              }))
            );
          } else {
            setCrops(FALLBACK_CROPS);
          }
        })
        .finally(() => setLoadingCrops(false));
    }
  }, [open, crops.length]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedCropId("");
      setSowingDate("");
      setSelectedImage(null);
      setImagePreview(null);
    }
  }, [open]);

  const validateFile = (file: File): boolean => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast({
        title: t("pestDetection.invalidFormat") as string || "Invalid format",
        description: t("pestDetection.imageFormatHint") as string || "Only JPEG, PNG, and JPG formats allowed.",
        variant: "destructive",
      });
      return false;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast({
        title: t("pestDetection.fileTooLarge") as string || "File too large",
        description: t("pestDetection.imageFormatHint") as string || "Max file size is 10 MB.",
        variant: "destructive",
      });
      return false;
    }
    return true;
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!validateFile(file)) {
      e.target.value = "";
      return;
    }
    setSelectedImage(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = ""; // reset input so same file can be re-selected
  };

  const removeImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
  };

  const handleSubmit = () => {
    if (!selectedCropId || !sowingDate || !selectedImage) return;
    const crop = crops.find((c) => String(c.crop_id) === selectedCropId);
    if (!crop) return;
    onSubmit(selectedCropId, crop.crop_name, sowingDate, selectedImage);
  };

  const isFormValid = selectedCropId && sowingDate && selectedImage;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto p-0">
        {/* Green header */}
        <div className="bg-primary text-primary-foreground px-6 py-4 rounded-t-lg">
          <DialogHeader>
            <DialogTitle className="text-primary-foreground text-center text-lg font-semibold">
              {(t("pestDetection.title") as string) || "Pest & Disease Identification"}
            </DialogTitle>
          </DialogHeader>
        </div>

        <div className="px-6 py-4 space-y-5">
          {/* Crop Selector */}
          <div className="space-y-2">
            <Label htmlFor="crop-select" className="text-sm font-medium">
              {(t("pestDetection.selectCrop") as string) || "Select Crop"}
            </Label>
            <Select value={selectedCropId} onValueChange={setSelectedCropId} disabled={loadingCrops}>
              <SelectTrigger id="crop-select" className="w-full">
                <SelectValue placeholder={loadingCrops ? "Loading..." : (t("pestDetection.selectCrop") as string) || "Select Crop"} />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {crops.map((crop) => (
                  <SelectItem key={crop.crop_id} value={String(crop.crop_id)}>
                    {crop.crop_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Sowing Date */}
          <div className="space-y-2">
            <Label htmlFor="sowing-date" className="text-sm font-medium">
              {(t("pestDetection.sowingDate") as string) || "Sowing Date"}
            </Label>
            <Input
              id="sowing-date"
              type="date"
              value={sowingDate}
              onChange={(e) => setSowingDate(e.target.value)}
              max={new Date().toISOString().split("T")[0]}
              className="w-full"
            />
          </div>

          {/* Image Upload Area */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-muted-foreground uppercase tracking-wide text-center block">
              {(t("pestDetection.plantPestImage") as string) || "Plant/Pest Image"}
            </Label>

            {imagePreview ? (
              <div className="relative rounded-lg border-2 border-dashed border-border p-2">
                <img
                  src={imagePreview}
                  alt="Selected crop"
                  className="w-full max-h-48 object-contain rounded-md"
                />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-3 right-3 h-7 w-7 rounded-full"
                  onClick={removeImage}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="border-2 border-dashed border-border rounded-lg p-6">
                <div className="flex justify-center gap-8">
                  {/* Capture Image */}
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex flex-col items-center gap-2 group cursor-pointer"
                  >
                    <div className="w-16 h-16 rounded-full border-2 border-foreground flex items-center justify-center group-hover:border-primary group-hover:bg-primary/5 transition-all">
                      <Camera className="h-7 w-7 group-hover:text-primary transition-colors" />
                    </div>
                    <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors">
                      {(t("pestDetection.captureImage") as string) || "Capture Image"}
                    </span>
                  </button>

                  {/* Select from Gallery */}
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="flex flex-col items-center gap-2 group cursor-pointer"
                  >
                    <div className="w-16 h-16 rounded-full border-2 border-foreground flex items-center justify-center group-hover:border-primary group-hover:bg-primary/5 transition-all">
                      <ImageIcon className="h-7 w-7 group-hover:text-primary transition-colors" />
                    </div>
                    <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors">
                      {(t("pestDetection.selectFromGallery") as string) || "Select From Gallery"}
                    </span>
                  </button>
                </div>

                <p className="text-xs text-muted-foreground text-center mt-4">
                  {(t("pestDetection.imageFormatHint") as string) || "Only JPEG, PNG, and JPG formats are allowed. Max 10 MB."}
                </p>
              </div>
            )}

            {/* Hidden file inputs */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/jpeg,image/png,image/jpg"
              capture="environment"
              onChange={handleFileSelect}
              className="hidden"
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/jpeg,image/png,image/jpg"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* Submit Button */}
          <Button
            onClick={handleSubmit}
            disabled={!isFormValid || isSubmitting}
            className="w-full h-12 rounded-lg text-base font-semibold"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                {(t("pestDetection.analyzing") as string) || "Analyzing..."}
              </>
            ) : (
              (t("pestDetection.analyzeSubmit") as string) || "Analyze & Submit"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
