import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Mic, MicOff, ChevronUp, ChevronLeft, ChevronRight, Info, Leaf } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SuggestionChips } from "@/components/SuggestionChips";
import { ChatMessage } from "@/components/ChatMessage";
import { useLanguage } from "@/components/LanguageProvider";
import { useIsMobile } from "@/hooks/use-mobile";
import { AudioWaveform } from "@/components/AudioWaveform";
import apiService from "@/lib/api";
import { EmptyStateScreen } from "@/components/EmptyStateScreen";
import { detectIndianLanguage, getCookie, setCookie } from "@/lib/utils";
import AutoResizeTextarea from "@/components/AutoResizeTextarea";
import { v4 as uuidv4 } from 'uuid';
import { environment } from "@/config/environment";
import { toast } from "@/hooks/use-toast";
import { startTelemetry, logQuestionEvent, logResponseEvent, endTelemetry, logFeedbackEvent, logErrorEvent } from "@/lib/telemetry";
// Import audio utilities
import { setupAudioVisualization, setupAudioRecording, stopRecording } from "@/lib/audio-utils";

// import { useKeycloak } from "@react-keycloak/web";
import { cn } from "@/lib/utils";
import { useTts } from "@/hooks/use-tts";
import { FeedbackForm } from "@/components/FeedbackForm";
import { useAuth } from "@/contexts/AuthContext";
import { PestDetectionDialog } from "@/components/PestDetectionDialog";
import {
  predictDisease,
  getAdvisory,
  storeResponse,
  FALLBACK_CROPS,
  type AdvisoryResult,
} from "@/lib/pest-detection-api";

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
  isFeedbackMessage?: boolean;
  isLoading?: boolean;
  isStreaming?: boolean;
  questionId?: string;
  questionText?: string;
  isErrorMessage?: boolean;
  errorTranslationKey?: string;
  responseLanguage?: string;
  imageUrl?: string;
}

interface ChatResponse {
  response: string;
  status: string;
}

interface TranscriptionResponse {
  text: string;
  lang_code: string;
  status: string;
}

interface SuggestionItem {
  question: string;
}

// Audio interfaces
interface Window {
  webkitAudioContext: typeof AudioContext;
  currentAudioStream?: MediaStream | null;
  mediaRecorder?: MediaRecorder | null;
}

export function ChatInterface() {
  const { language, t } = useLanguage();
  const { user, isLoading: isAuthLoading } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [inputPositioned, setInputPositioned] = useState(true);
  // Auto-resize now handled by AutoResizeTextarea; no explicit rows state
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const initialSuggestionRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [maxRecordingDuration, setMaxRecordingDuration] = useState(20000); // 8 seconds in milliseconds
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isMessageLoading, setIsMessageLoading] = useState(false); // Track if a message is currently loading

  // Suggestion related states
  const [displayedSuggestion, setDisplayedSuggestion] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [currentSuggestion, setCurrentSuggestion] = useState("");
  const [typingIndex, setTypingIndex] = useState(0);
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [allSuggestions, setAllSuggestions] = useState<string[]>([]);
  const [currentSuggestionIndex, setCurrentSuggestionIndex] = useState(0);

  // Audio related states and refs
  const [audioLevel, setAudioLevel] = useState(0.5);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioDataRef = useRef<Uint8Array | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  
  // Feedback related states
  const feedbackOptions = t("feedbackOptions") as string[];
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [dislikedMessageId, setDislikedMessageId] = useState<string | null>(null);
  const [likedMessageId, setLikedMessageId] = useState<string | null>(null);
  const [feedbackQuestionText, setFeedbackQuestionText] = useState("");
  const [feedbackResponseText, setFeedbackResponseText] = useState("");
  const [isFeedbackRecording, setIsFeedbackRecording] = useState(false);
  const feedbackRecordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const feedbackAudioAnalyserRef = useRef<AnalyserNode | null>(null);
  const feedbackAudioDataRef = useRef<Uint8Array | null>(null);
  const feedbackAnimationFrameRef = useRef<number | null>(null);
  const feedbackMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const feedbackAudioStreamRef = useRef<MediaStream | null>(null);
  const [feedbackAudioLevel, setFeedbackAudioLevel] = useState(0.5);

  // Pest detection state
  const [showPestDetectionDialog, setShowPestDetectionDialog] = useState(false);
  const [isPestDetectionSubmitting, setIsPestDetectionSubmitting] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const inputContainerRef = useRef<HTMLDivElement>(null);

  // Guest limit state
  const [guestLimitReached, setGuestLimitReached] = useState(false);

  const { stopAudio } = useTts();

  // Add this effect to update the input height CSS variable
  useEffect(() => {
    const updateInputHeight = () => {
      if (inputContainerRef.current) {
        const inputHeight = inputContainerRef.current.offsetHeight;
        document.documentElement.style.setProperty('--input-height', `${inputHeight}px`);
      }
    };
    
    // Call initially and set up resize observer
    updateInputHeight();
    
    const resizeObserver = new ResizeObserver(updateInputHeight);
    if (inputContainerRef.current) {
      resizeObserver.observe(inputContainerRef.current);
    }
    
    window.addEventListener('resize', updateInputHeight);
    
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateInputHeight);
    };
  }, []);

  // Helper functions for managing messages
  const addMessage = (text: string, isUser: boolean, options = {}): string => {
    const id = `${isUser ? 'user' : 'bot'}-${uuidv4()}`;
    const newMessage: Message = {
      id,
      text,
      isUser,
      timestamp: new Date(),
      ...options
    };
    
    setMessages(prev => [...prev, newMessage]);
    return id;
  };

  const updateMessage = (id: string, updates: Partial<Message>) => {
    setMessages(prev =>
      prev.map(msg => (msg.id === id ? { ...msg, ...updates } : msg))
    );
  };

  // Helper to get telemetry uid - returns "guest" for guest users
  const getTelemetryUid = useCallback(() => {
    return user?.is_guest_user ? "guest" : (user?.username || "default-username");
  }, [user]);

  // Notify host app (iframe parent) when guest limit is reached
  const notifyGuestLimitReached = useCallback((questionsAsked: number) => {
    try {
      window.parent.postMessage(
        {
          type: 'questions-limit-reached',
          timestamp: new Date().toISOString(),
          data: {
            questionsAsked,
            limit: environment.guestUserLimit,
          },
        },
        '*'
      );
    } catch (e) {
      console.error('postMessage failed:', e);
    }
  }, []);

  // Create a session ID
  const createSession = useCallback(() => {
    const newSessionId = uuidv4();
    setSessionId(newSessionId);
    apiService.setSessionId(newSessionId);
    startTelemetry(newSessionId, { preferred_username: getTelemetryUid(), email: user?.email || "default-email" });
    return newSessionId;
  }, [user, getTelemetryUid]);

  // Get user location
  const getUserLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const locationData = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
          apiService.setLocationData(locationData);
        },
        (error) => {
          console.log("Unable to retrieve location:", error);
          
          // Show toast notification based on the error
          // switch(error.code) {
          //   case error.PERMISSION_DENIED:
          //     toast({
          //       title: t("toast.locationPermissionDenied.title") as string,
          //       description: t("toast.locationPermissionDenied.description") as string,
          //       variant: "yellow",
          //     });
          //     break;
          //   case error.POSITION_UNAVAILABLE:
          //     toast({
          //       title: t("toast.locationUnavailable.title") as string,
          //       description: t("toast.locationUnavailable.description") as string,
          //       variant: "yellow",
          //     });
          //     break;
          //   case error.TIMEOUT:
          //     toast({
          //       title: t("toast.locationTimeout.title") as string,
          //       description: t("toast.locationTimeout.description") as string,
          //       variant: "yellow",
          //     });
          //     break;
          //   default:
          //     toast({
          //       title: t("toast.locationError.title") as string,
          //       description: t("toast.locationError.description") as string,
          //       variant: "yellow",
          //     });
          // }
        }
      );
    } else {
      // toast({
      //   title: t("toast.locationNotSupported.title") as string,
      //   description: t("toast.locationNotSupported.description") as string,
      //   variant: "yellow",
      // });
    }
  };

  // Fetch suggestions for the chat - only called after a chat response
  const fetchSuggestions = async (currentSession = sessionId) => {
    // Use the current sessionId or create a new one if needed
    const sessionToUse = currentSession || createSession();
    
    try {
      const suggestions = await apiService.getSuggestions(sessionToUse, language) as SuggestionItem[];
      if (suggestions && suggestions.length > 0) {
        setNewSuggestion(suggestions);
      }
    } catch (error) {
      console.error("Failed to fetch suggestions:", error);
      // Set a fallback suggestion if API fails
      // const fallbackSuggestions = [
      //   "What is the weather forecast for tomorrow?",
      //   "Tell me about PM Kisan Yojana",
      //   "What is the current market price of wheat?",
      //   "How to prevent crop diseases during monsoon?",
      // ];
      // setNewSuggestion({ question: fallbackSuggestions[Math.floor(Math.random() * fallbackSuggestions.length)] });
    
    }
  };

  const setNewSuggestion = (suggestions: SuggestionItem[] | { question: string }) => {
    let suggestionsList: string[];
    
    if (Array.isArray(suggestions)) {
      suggestionsList = suggestions.map(s => s.question);
    } else {
      suggestionsList = [suggestions.question];
    }
    
    setAllSuggestions(suggestionsList);
    setCurrentSuggestion(suggestionsList[0]);
    setCurrentSuggestionIndex(0);
  };

  // Effect to cycle through suggestions every 10 seconds
  useEffect(() => {
    if (allSuggestions.length === 0) return;

    const cycleTimer = setInterval(() => {
      setCurrentSuggestionIndex(prevIndex => {
        const nextIndex = (prevIndex + 1) % allSuggestions.length;
        setCurrentSuggestion(allSuggestions[nextIndex]);
        return nextIndex;
      });
    }, 10000); // 10 seconds

    return () => clearInterval(cycleTimer);
  }, [allSuggestions]);

  // Handle text message sending
  const handleSendMessage = async () => {
    if (inputValue.trim() === "" || isMessageLoading) return;

    if (user?.is_guest_user) {
      const guestCount = parseInt(getCookie('guest_question_count') || '0');
      if (guestCount >= environment.guestUserLimit) {
        setGuestLimitReached(true);
        notifyGuestLimitReached(guestCount);
        return;
      }
    }

    if (!inputPositioned) {
      setInputPositioned(true);
    }
    scrollToBottomOfMessages();
    // Add user message
    const userMessageId = addMessage(inputValue, true);
    
    // Add loading message for bot
    const loadingMessageId = addMessage("", false, { isLoading: true });
    
    // Set message loading state
    setIsMessageLoading(true);
    
    // Clear input
    setInputValue("");

    try {
      await sendMessageToApi(inputValue, loadingMessageId);
    } catch (error) {
      console.error("Error sending message:", error);
      updateMessage(loadingMessageId, {
        text: '',
        isLoading: false,
        isErrorMessage: true,
        errorTranslationKey: 'toast.apiError.description',
      });
    } finally {
      // Reset loading state when done
      setIsMessageLoading(false);
    }
  };

  // When an error occurs, ensure the UI updates completely
  const forceUIRefresh = () => {
    // Force a style update to trigger reflow
    if (scrollContainerRef.current) {
      scrollContainerRef.current.style.overflow = 'hidden';
      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.style.overflow = '';
        }
        scrollToBottomOfMessages();
      }, 50);
    }
  };

  // Core API communication function
  const sendMessageToApi = async (text: string, loadingMessageId: string) => {
    // Determine target and source language
    const targetLang = language;
    // Use the selected language directly as source language
    // (detectIndianLanguage disabled — misdetects bhb as hi since both share Devanagari)
    // const detectedLanguage = detectIndianLanguage(text);
    const sourceLang: string = language;
    console.log(sourceLang);
    const questionId = uuidv4();
    startTelemetry(sessionId, { preferred_username: getTelemetryUid(), email: user?.email || "default-email" });
    logQuestionEvent(questionId, sessionId, text);
    endTelemetry();
    // Use the current sessionId or create a new UUID if needed
    const currentSession = sessionId || createSession();
    
    // Handle streaming response
    let streamingText = "";
    
    try {
      // Set streaming state to true when we begin receiving message chunks
      updateMessage(loadingMessageId, {
        isLoading: false,
        isStreaming: true,
        questionId,
        questionText: text,
        responseLanguage: targetLang
      });
      
      const response = await apiService.sendUserQuery(
        text,
        currentSession,
        sourceLang,
        targetLang,
        (chunk) => {
          // Update the message with the streaming text
          scrollToBottom(); 
          streamingText += chunk;
          updateMessage(loadingMessageId, {
            text: streamingText,
            isStreaming: true,
            questionId,
            questionText: text,
            responseLanguage: targetLang
          });
        }
      ) as ChatResponse;

      if (response && response.response) {
        // Final update with complete response - set streaming to false
        updateMessage(loadingMessageId, {
          text: response.response,
          isStreaming: false,
          questionId,
          questionText: text,
          responseLanguage: targetLang
        });
        
        if (user?.is_guest_user) {
          const guestCount = parseInt(getCookie('guest_question_count') || '0');
          const newCount = guestCount + 1;
          setCookie('guest_question_count', newCount.toString(), 7);
          if (newCount >= environment.guestUserLimit) {
            setGuestLimitReached(true);
            notifyGuestLimitReached(newCount);
          }
        }
        
        startTelemetry(sessionId, { preferred_username: getTelemetryUid(), email: user?.email || "default-email" });
        logResponseEvent(questionId, sessionId, text, response.response);
        endTelemetry();
        // Fetch new suggestions after the message is sent
        fetchSuggestions(currentSession);
      } else {
        // Handle empty response
        updateMessage(loadingMessageId, {
          text: '',
          isErrorMessage: true,
          isStreaming: false,
          questionId,
          questionText: text,
          errorTranslationKey: 'toast.apiEmptyResponse.description',
          isLoading: false,
        });
        startTelemetry(sessionId, { preferred_username: user?.username || "default-username", email: user?.email || "default-email" });
        logErrorEvent(questionId, sessionId, "Empty response from API");
        endTelemetry();
      }
    } catch (error) {
      console.error("Error sending query to API:", error);
      
      // Check if it's a rate limit error (429)
      const isRateLimitError = (error as any)?.status === 429 || (error instanceof Error && error.message.includes('Rate limit'));
      const errorTranslationKey = isRateLimitError ? 'toast.rateLimitError.description' : 'toast.apiError.description';
      
      // Handle error response with clear error message
      updateMessage(loadingMessageId, {
        text: '',
        isLoading: false,
        isErrorMessage: true,
        errorTranslationKey: errorTranslationKey,
      });
      
      // Force UI refresh for error messages
      forceUIRefresh();
      
      startTelemetry(sessionId, { preferred_username: getTelemetryUid(), email: user?.email || "default-email" });
      logErrorEvent(questionId, sessionId, isRateLimitError ? "Rate limit error (429)" : "API error: " + (error instanceof Error ? error.message : String(error)));
      endTelemetry();
    }
  };

  // Audio recording functions
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await setIsRecording(true);
      
      // Store the stream in the ref
      audioStreamRef.current = stream;
      
      // Use the audio utility functions
      setupAudioVisualization(
        stream, 
        audioAnalyserRef, 
        audioDataRef, 
        animationFrameRef, 
        setAudioLevel
      );
      
    setupAudioRecording(
        stream, 
        mediaRecorderRef, 
        (transcribedText: string) => {
          // Handle transcribed text callback
      setInputValue(prevValue => prevValue + (prevValue ? " " : "") + transcribedText);
          setTimeout(() => {
            const textarea = textareaRef.current;
            if (!textarea) return;
            textarea.style.height = '40px';
            const scrollHeight = textarea.scrollHeight;
            if (scrollHeight > 40) {
              textarea.style.height = `${Math.min(scrollHeight, 120)}px`;
            }
          }, 10);
        },
        sessionId,
        toast,
        language
      );
      
      // Set timeout to stop recording after maxRecordingDuration
      recordingTimerRef.current = setTimeout(() => {
        stopRecording(
          setIsRecording, 
          recordingTimerRef, 
          animationFrameRef, 
          mediaRecorderRef, 
          audioStreamRef, 
          audioAnalyserRef, 
          audioDataRef
        );
      }, maxRecordingDuration);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      toast({
        title: "Microphone permission required",
        description: "Please allow microphone access in your browser settings to record audio.",
        variant: "yellow"
      });
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording(
        setIsRecording, 
        recordingTimerRef, 
        animationFrameRef, 
        mediaRecorderRef, 
        audioStreamRef, 
        audioAnalyserRef, 
        audioDataRef
      );
    } else {
      startRecording();
    }
  };

  // Pest detection submit handler
  const getLocalizedFieldValue = (
    values: { en?: string; mr?: string; hi?: string },
    fallback = ""
  ): string => {
    const preferredValues = language === "mr"
      ? [values.mr, values.en, values.hi]
      : language === "hi"
        ? [values.hi, values.en, values.mr]
        : [values.en, values.mr, values.hi];

    const selected = preferredValues.find(
      (value) => typeof value === "string" && value.trim().length > 0
    );

    return selected || fallback;
  };

  const formatAdvisoryText = (value: string): string => {
    const normalized = value.replace(/\r\n/g, "\n").trim();
    if (!normalized) return "";
    // Keep numbered advisory points readable in markdown.
    return normalized.replace(/\n(?=\d+\.)/g, "\n\n");
  };

  const handlePestDetectionSubmit = async (
    cropId: string,
    cropName: string,
    sowingDate: string,
    image: File,
    cropNameEnglish?: string
  ) => {
    setIsPestDetectionSubmitting(true);
    setShowPestDetectionDialog(false);
    setIsMessageLoading(true);

    // Create a URL for the image to display in chat
    const imageObjectUrl = URL.createObjectURL(image);

    // Resolve English crop name for the API (API requires English names)
    const englishCrop = FALLBACK_CROPS.find((c) => String(c.crop_id) === cropId);
    const cropTypeForApi = cropNameEnglish || (englishCrop ? englishCrop.crop_name : cropName);

    // Add user message with image, crop name and sowing date (right side)
    if (!inputPositioned) {
      setInputPositioned(true);
    }
    addMessage(
      `**${cropName}**\n${sowingDate}`,
      true,
      { imageUrl: imageObjectUrl }
    );

    // Add a loading bot message (left side)
    const loadingMessageId = addMessage("", false, { isLoading: true });
    scrollToBottomOfMessages();

    try {
      // Step 1: Predict (always use English crop name for API)
      const prediction = await predictDisease(cropTypeForApi, sowingDate, image, cropIdForApi);

      if (!prediction.success || !prediction.data?.predictions?.length) {
        const resultLabel = (t("pestDetection.resultLabel") as string) || "Pest/Disease";
        const unknownDisease = (t("pestDetection.unknownDisease") as string) || "Unknown Disease";
        const unknownDiseaseMessage = (t("pestDetection.unknownDiseaseMessage", { crop: cropName }) as string)
          || `The system could not identify a specific disease for ${cropName}. Please try again with a clearer image or consult a local agriculture officer.`;

        updateMessage(loadingMessageId, {
          text: `### ${resultLabel}: ${unknownDisease}\n\n${unknownDiseaseMessage}`,
          isLoading: false,
          isStreaming: false,
        });
        // Store even unsuccessful responses
        try {
          await storeResponse(
            image,
            cropIdForApi,
            sowingDate,
            false,
            JSON.stringify(prediction),
            user?.username || "0",
            "0"
          );
        } catch (storeErr) {
          console.error("Failed to store response:", storeErr);
        }
        return;
      }

      const topPrediction = prediction.data.predictions[0];
      const diseaseId = topPrediction.disease_id;
      const diseaseType = topPrediction.disease_type;
      const confidence = (topPrediction.confidence_score * 100).toFixed(1);
      const noInformation = (t("pestDetection.noInformation") as string) || "No information available.";

      // Step 2: Get advisory
      let advisory: AdvisoryResult = {
        preventive_measures: noInformation,
        curative_measures: noInformation,
      };
      try {
        advisory = await getAdvisory(diseaseId);
      } catch (advErr) {
        console.error("Failed to get advisory:", advErr);
      }

      const diseaseTypeText = getLocalizedFieldValue(
        {
          en: advisory.disease_pest || diseaseType,
          mr: advisory.disease_pest_mr,
          hi: advisory.disease_pest_hi,
        },
        diseaseType
      );

      const preventiveMeasures = formatAdvisoryText(
        getLocalizedFieldValue(
          {
            en: advisory.preventive_measures,
            mr: advisory.preventive_measures_mr,
            hi: advisory.preventive_measures_hi,
          },
          noInformation
        )
      ) || noInformation;

      const curativeMeasures = formatAdvisoryText(
        getLocalizedFieldValue(
          {
            en: advisory.curative_measures,
            mr: advisory.curative_measures_mr,
            hi: advisory.curative_measures_hi,
          },
          noInformation
        )
      ) || noInformation;

      // Step 3: Store response
      try {
        await storeResponse(
          image,
          cropIdForApi,
          sowingDate,
          true,
          JSON.stringify(prediction),
          user?.username || "0",
          diseaseId
        );
      } catch (storeErr) {
        console.error("Failed to store response:", storeErr);
      }

      // Format the result as markdown
      const resultMarkdown = [
        `### ${(t("pestDetection.resultLabel") as string) || "Pest/Disease"}: **${diseaseTypeText}**`,
        `**${(t("pestDetection.confidenceLabel") as string) || "Confidence"}:** ${confidence}%`,
        `**${(t("pestDetection.cropLabel") as string) || "Crop"}:** ${cropName} | **${(t("pestDetection.sowingDateLabel") as string) || "Sowing Date"}:** ${sowingDate}`,
        ``,
        `---`,
        ``,
        `#### ${(t("pestDetection.preventiveMeasuresLabel") as string) || "Preventive Measures"}`,
        preventiveMeasures,
        ``,
        `#### ${(t("pestDetection.curativeMeasuresLabel") as string) || "Curative Measures"}`,
        curativeMeasures,
      ].join("\n");

      // Update the loading message with the final result
      updateMessage(loadingMessageId, {
        text: resultMarkdown,
        isLoading: false,
        isStreaming: false,
      });
    } catch (error) {
      console.error("Pest detection failed:", error);
      updateMessage(loadingMessageId, {
        text: "",
        isLoading: false,
        isErrorMessage: true,
        errorTranslationKey: "pestDetection.errorGeneric",
      });
      forceUIRefresh();
    } finally {
      setIsMessageLoading(false);
      setIsPestDetectionSubmitting(false);
    }
  };

  // Feedback handling
  const handleDislike = (messageId: string, questionText: string, responseText: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message) return;

    setDislikedMessageId(messageId);
    setFeedbackQuestionText(questionText);
    setFeedbackResponseText(responseText);
    setShowFeedbackDialog(true);
  };

  const handleLike = (messageId: string, questionText: string, responseText: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message) return;

    setLikedMessageId(messageId);
    setFeedbackQuestionText(questionText);
    setFeedbackResponseText(responseText);
    
    // Send telemetry for the like event
    startTelemetry(sessionId, { preferred_username: getTelemetryUid(), email: user?.email || "default-email" });
    logFeedbackEvent(message.questionId || messageId, sessionId, "Liked the response", "like", message.questionText || "", message.text);
    endTelemetry();

    // Send a generic feedback message
    toast({
      title: t("toast.feedbackThankYou.title") as string,
      description: t("toast.feedbackThankYou.description") as string,
    });
  };
  
  const submitFeedback = () => {
    const message = messages.find(m => m.id === dislikedMessageId);
    if (!message) return;

    toast({
      title: t("toast.feedbackSubmitted.title") as string,
      description: t("toast.feedbackSubmitted.description") as string,
    });
    
    startTelemetry(sessionId, { preferred_username: getTelemetryUid(), email: user?.email || "default-email" });
    logFeedbackEvent(message.questionId || dislikedMessageId, sessionId, feedbackText, "dislike", message.questionText || "", message.text);
    endTelemetry();
    setShowFeedbackDialog(false);
    setFeedbackText("");
    setDislikedMessageId(null);
    setFeedbackQuestionText("");
    setFeedbackResponseText("");
  };

  // UI interactions
  const handleSuggestionSelect = (suggestion: string) => {
    setInputValue(suggestion);
  };

  // Modify isNearBottom to handle scroll calculations better
  const isNearBottom = useCallback(() => {
    // Find the real scrollable element more reliably
    const findCurrentScrollElement = () => {
      if (viewportRef.current) return viewportRef.current;
      
      if (scrollContainerRef.current) {
        const viewport = scrollContainerRef.current.closest('[data-radix-scroll-area-viewport]');
        if (viewport) return viewport as HTMLDivElement;
      }
      
      return scrollContainerRef.current;
    };
    
    const scrollElement = findCurrentScrollElement();
    if (!scrollElement) {
      // console.log('No scroll element found in isNearBottom');
      return true; // Default to true if we can't find the container
    }
    
    const threshold =80; // 50px from bottom threshold
    
    const scrollHeight = scrollElement.scrollHeight;
    const scrollTop = scrollElement.scrollTop;
    const clientHeight = scrollElement.clientHeight;
    const bottomPosition = scrollHeight - scrollTop - clientHeight;
    return bottomPosition < threshold;
  }, []);

  // Modify the scrollToBottom function to prevent unwanted scrolling when keyboard is open
  const scrollToBottom = useCallback(() => {
    // Don't auto-scroll when keyboard is open on mobile
    if (isMobile && isKeyboardVisible) return;
    
    const shouldScroll = isNearBottom();
    if (shouldScroll) {
      const scrollElement = viewportRef.current || 
                          (scrollContainerRef.current?.closest('[data-radix-scroll-area-viewport]') as HTMLDivElement) || 
                          scrollContainerRef.current;
                          
      if (scrollElement) {
        const bottomPosition = scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
        
        // If exactly at bottom (within 1px), use instant scroll, otherwise smooth scroll
        const scrollBehavior = bottomPosition <= 1 ? "auto" : "smooth";
        messagesEndRef.current?.scrollIntoView({ behavior: scrollBehavior as ScrollBehavior });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    }
  }, [isMobile, isKeyboardVisible, isNearBottom]);

  // Modify scrollToBottomOfMessages to respect keyboard state on mobile
  const scrollToBottomOfMessages = () => {
    // Don't force scroll when keyboard is open on mobile
    if (isMobile && isKeyboardVisible) return;
    
    // Use setTimeout to ensure DOM is updated
    setTimeout(() => {
      const scrollElement = viewportRef.current || 
                         (scrollContainerRef.current?.closest('[data-radix-scroll-area-viewport]') as HTMLDivElement) || 
                         scrollContainerRef.current;
      
      if (scrollElement) {
        // Always scroll to bottom regardless of current position
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
      // Also use scrollIntoView as backup
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 500);
  }
  
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setInputValue(text);
  };

  // Start recording for feedback
  const startFeedbackRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await setIsFeedbackRecording(true);
      
      // Store the stream in the ref
      feedbackAudioStreamRef.current = stream;
      
      // Use the audio utility functions
      setupAudioVisualization(
        stream, 
        feedbackAudioAnalyserRef, 
        feedbackAudioDataRef, 
        feedbackAnimationFrameRef, 
        setFeedbackAudioLevel
      );
      
      setupAudioRecording(
        stream, 
        feedbackMediaRecorderRef, 
        (transcribedText: string) => {
          // Handle transcribed text callback for feedback
          setFeedbackText(prevValue => prevValue + (prevValue ? " " : "") + transcribedText);
        },
        sessionId,
        toast,
        language
      );
      
      // Set timeout to stop recording after maxRecordingDuration
      feedbackRecordingTimerRef.current = setTimeout(() => {
        stopFeedbackRecording();
      }, maxRecordingDuration);
    } catch (err) {
      console.error("Error accessing microphone for feedback:", err);
      toast({
        title: "Microphone permission required",
        description: "Please allow microphone access in your browser settings to record feedback.",
        variant: "yellow"
      });
    }
  };

  const stopFeedbackRecording = () => {
    stopRecording(
      setIsFeedbackRecording, 
      feedbackRecordingTimerRef, 
      feedbackAnimationFrameRef, 
      feedbackMediaRecorderRef, 
      feedbackAudioStreamRef, 
      feedbackAudioAnalyserRef, 
      feedbackAudioDataRef
    );
  };

  const toggleFeedbackRecording = () => {
    if (isFeedbackRecording) {
      stopFeedbackRecording();
    } else {
      startFeedbackRecording();
    }
  };

  // Effects
  useEffect(() => {
    // Wait for auth to be loaded before initializing session
    // This ensures proper user details are passed to telemetry
    if (!isAuthLoading && !sessionId) {
      createSession();
    }
  }, [createSession, isAuthLoading, sessionId]);
  
  useEffect(() => {
    getUserLocation();
  }, []);
  
  useEffect(() => {
    if (!user?.is_guest_user) return;
    const guestCount = parseInt(getCookie('guest_question_count') || '0');
    if (guestCount >= environment.guestUserLimit) {
      setGuestLimitReached(true);
      notifyGuestLimitReached(guestCount);
    }
  }, [user, notifyGuestLimitReached]);

  useEffect(() => {
    // Don't auto-scroll when keyboard is open on mobile
    if (isMobile && isKeyboardVisible) return;
    
    // Always scroll to bottom when messages change
    scrollToBottom();
  }, [messages, isMobile, isKeyboardVisible, scrollToBottom]);
  
  // Remove the typing animation effect for suggestions
  useEffect(() => {
    if (!isTyping || !currentSuggestion) return;
    
    if (typingIndex >= currentSuggestion.length) {
      setIsTyping(false);
      return;
    }
    
    const typingTimeout = setTimeout(() => {
      setDisplayedSuggestion(prev => prev + currentSuggestion.charAt(typingIndex));
      setTypingIndex(prev => prev + 1);
    }, 50);
    
    return () => clearTimeout(typingTimeout);
  }, [isTyping, typingIndex, currentSuggestion]);

  // Auto-resize handled by AutoResizeTextarea component

  // Add a keyboard detection effect
  useEffect(() => {
    if (!isMobile) return;
    
    // Helper function to handle keyboard detection
    const handleKeyboardAppearance = () => {
      // On iOS, we can detect keyboard appearance by window height changes
      const visualViewport = window.visualViewport;
      if (!visualViewport) return;
      
      // Track keyboard visibility by comparing visual viewport height to window inner height
      const handleVisualViewportChange = () => {
        const kbHeight = Math.max(0, window.innerHeight - visualViewport.height);
        document.documentElement.style.setProperty('--keyboard-offset', `${kbHeight}px`);
        
        setKeyboardHeight(kbHeight);
        
        // Only change keyboard visibility state if significant height change
        if (kbHeight > 100 && !isKeyboardVisible) {
          setIsKeyboardVisible(true);
          
          // Make sure input sits directly on top of keyboard with no gap
          if (inputContainerRef.current) {
            // Remove the bottom property since we'll use transform in the component
            inputContainerRef.current.style.bottom = '0';
          }
        } else if (kbHeight <= 100 && isKeyboardVisible) {
          setIsKeyboardVisible(false);
          
          // Keyboard is hidden
          if (inputContainerRef.current) {
            inputContainerRef.current.style.bottom = '0';
          }
        }
      };
      
      visualViewport.addEventListener('resize', handleVisualViewportChange);
      return () => visualViewport.removeEventListener('resize', handleVisualViewportChange);
    };
    
    const cleanup = handleKeyboardAppearance();
    return cleanup;
  }, [isMobile, isKeyboardVisible]);

  const handlePreviousSuggestion = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setCurrentSuggestionIndex(prevIndex => {
      const newIndex = prevIndex > 0 ? prevIndex - 1 : allSuggestions.length - 1;
      setCurrentSuggestion(allSuggestions[newIndex]);
      return newIndex;
    });
  };

  const handleNextSuggestion = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setCurrentSuggestionIndex(prevIndex => {
      const nextIndex = (prevIndex + 1) % allSuggestions.length;
      setCurrentSuggestion(allSuggestions[nextIndex]);
      return nextIndex;
    });
  };

  // Render a different input for mobile
  const renderMobileInput = () => {
    // Fix for iOS to ensure the input sticks to the keyboard
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    const adjustedHeight = isIOS && isKeyboardVisible ? keyboardHeight - 1 : keyboardHeight; // -1px to ensure visual contact on iOS
    
    return (
      <>
      <div 
        className="fixed left-0 right-0 bottom-0 z-20 flex flex-col"
        style={{
          transform: isKeyboardVisible ? `translateY(-${adjustedHeight}px)` : 'none',
          paddingBottom: isKeyboardVisible ? '0' : 'env(safe-area-inset-bottom, 8px)'
        }}
      >
        {currentSuggestion && (
          <div 
            className="mx-3 mb-2 bg-background/95 p-3 backdrop-blur rounded-lg text-sm cursor-pointer border border-primary hover:border hover:border-primary transition-all"
            onClick={() => handleSuggestionSelect(currentSuggestion)}
          >
            <div className="flex items-center justify-between">
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-6 w-6 rounded-full" 
                onClick={handlePreviousSuggestion}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="font-medium">{currentSuggestion}</div>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-6 w-6 rounded-full" 
                onClick={handleNextSuggestion}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        <div 
          ref={inputContainerRef}
          className={cn(
            "bg-background border-t border-border transition-all duration-200",
            isKeyboardVisible ? "shadow-lg border-b-0" : ""
          )}
        >
          <div className="p-3">
            <div className="flex items-center gap-2 bg-background rounded-lg border border-border p-2">
              <AutoResizeTextarea
                ref={textareaRef}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyPress}
                onFocus={() => {
                  // Ensure positioning gets updated on focus
                  if (window.visualViewport) {
                    const kbHeight = Math.max(0, window.innerHeight - window.visualViewport.height);
                    if (kbHeight > 100) {
                      setIsKeyboardVisible(true);
                      setKeyboardHeight(kbHeight);
                    }
                  }
                }}
                placeholder={t("inputPlaceholder") as string}
                className="flex-1 transition-all duration-100"
                style={{ 
                  paddingRight: '8px',
                  paddingLeft: '8px',
                  paddingTop: '6px',
                  paddingBottom: '6px',
                  fontSize: isMobile ? '16px' : '',
                }}
                disabled={isMessageLoading}
                minRows={1}
                maxRows={6}
              />
              <div className="flex flex-shrink-0 gap-2">
                <Button
                  onClick={() => setShowPestDetectionDialog(true)}
                  variant="outline"
                  size="icon"
                  className="rounded-full flex-shrink-0 h-9 w-9"
                  aria-label="Pest Detection"
                  disabled={isMessageLoading}
                >
                  <Leaf className="h-4 w-4" />
                </Button>
                <Button
                  onClick={toggleRecording}
                  variant={isRecording ? "destructive" : "outline"}
                  size="icon"
                  className="rounded-full flex-shrink-0 h-9 w-9"
                  aria-label={isRecording ? t("stopRecording") as string : t("startRecording") as string}
                  disabled={isMessageLoading}
                >
                  {isRecording ? (
                    <AudioWaveform isActive={isRecording} audioLevel={audioLevel} />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  onClick={handleSendMessage}
                  disabled={inputValue.trim() === "" || isMessageLoading}
                  variant="default"
                  size="icon"
                  className="rounded-full flex-shrink-0 h-9 w-9"
                  aria-label={t("send") as string}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground text-center mt-1 flex items-center justify-center">
              <Info className="h-3 w-3 mr-1 inline-block" />
              {(t("disclaimerText") as string) || "Vistaar is AI and can make mistakes. Please verify sources."}
            </div>
          </div>
        </div>
      </div>
      </>
    );
  };

  // Update cleanup in useEffect to stop audio when component unmounts
  useEffect(() => {
    return () => {
      // No need to stop audio here as the AudioPlayer handles its own cleanup
    };
  }, []);

  return (
    <div className="flex flex-col h-full relative p-[0px!important]">
      {/* Guest limit reached overlay — covers full viewport so nothing bleeds through */}
      {guestLimitReached && (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background px-6 text-center">
          <div className="rounded-2xl border border-border bg-card p-8 shadow-lg max-w-sm w-full">
            <div className="text-4xl mb-4">🌾</div>
            <h2 className="text-xl font-bold text-primary mb-2">
              {(t("guestLimitTitle") as string) || "Free limit reached"}
            </h2>
            <p className="text-muted-foreground text-sm mb-6">
              {(t("guestLimitDescription") as string) ||
                "You have used all 10 free questions. Please log in to continue."}
            </p>
            <Button
              className="w-full"
              onClick={() => {
                window.parent.postMessage(
                  { type: 'login-requested', timestamp: new Date().toISOString() },
                  '*'
                );
              }}
            >
              {(t("loginToContinue") as string) || "Login / Register"}
            </Button>
          </div>
        </div>
      )}

      {messages.length === 0 ? (
        <EmptyStateScreen setInputValue={setInputValue} />
      ) : (
        <ScrollArea className="flex-1 h-[calc(100vh-var(--header-height)-var(--input-height))]">
          <div 
            ref={(el) => {
              scrollContainerRef.current = el;
              // Also set viewportRef to the parent scroll viewport
              if (el) {
                const viewport = el.closest('[data-radix-scroll-area-viewport]') as HTMLDivElement;
                if (viewport) viewportRef.current = viewport;
              }
            }}
            className={cn(
              isMobile ? 
                isKeyboardVisible ? "pb-24 md:pb-20" : "pb-32 md:pb-20 mt-20" 
                : "pb-24 md:pb-20",
              messages.length === 1 ? "min-h-[70vh]" : "" // Ensure single message has enough height
            )}
          >
            <div className={cn(
              "message-container",
              isMobile ? "space-y-4 px-2" : "space-y-4 px-4" // Increased spacing on mobile
            )}>
              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message.text}
                  isUser={message.isUser}
                  timestamp={message.timestamp}
                  onDislike={
                    !message.isUser && !message.isLoading && !message.isFeedbackMessage 
                      ? (questionText: string, responseText: string) => handleDislike(message.id, message.questionText || "", message.text)
                      : undefined
                  }
                  onLike={
                    !message.isUser && !message.isLoading && !message.isFeedbackMessage 
                      ? (questionText: string, responseText: string) => handleLike(message.id, message.questionText || "", message.text)
                      : undefined
                  }
                  messageId={message.id}
                  isLoading={message.isLoading}
                  isStreaming={message.isStreaming}
                  isFeedbackMessage={message.isFeedbackMessage}
                  questionText={message.questionText}
                  responseText={message.text}
                  isErrorMessage={message.isErrorMessage}
                  errorTranslationKey={message.errorTranslationKey}
                  responseLanguage={message.responseLanguage}
                  imageUrl={message.imageUrl}
                />
              ))}
              <div ref={messagesEndRef} className="h-8" />
            </div>
          </div>
        </ScrollArea>
      )}
      
      {/* Render different input containers for mobile vs desktop */}
      {isMobile ? (
        renderMobileInput()
      ) : (
        <div className="fixed bottom-0 left-0 right-0 bg-background/95 supports-[backdrop-filter]:bg-background/0">
          <div className="border-border">
            <div className="p-4">
              <div className="relative max-w-2xl mx-auto">
                {currentSuggestion && (
                  <div 
                    className="absolute -top-16 left-4 right-4 bg-background/95 p-3 backdrop-blur rounded-lg text-sm z-10 cursor-pointer hover:border hover:border-primary transition-all"
                    onClick={() => handleSuggestionSelect(currentSuggestion)}
                  >
                    <div className="flex items-center justify-between">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6 rounded-full" 
                        onClick={handlePreviousSuggestion}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <div className="font-medium">{currentSuggestion}</div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6 rounded-full" 
                        onClick={handleNextSuggestion}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2 bg-background rounded-lg border border-border p-2">
                  <AutoResizeTextarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyPress}
                    placeholder={t("inputPlaceholder") as string}
                    className="flex-1 transition-all duration-100"
                    style={{ 
                      paddingRight: '8px',
                      paddingLeft: '8px',
                      fontSize: isMobile ? '16px' : '',
                    }}
                    minRows={1}
                    maxRows={6}
                  />
                  <Button
                    onClick={() => setShowPestDetectionDialog(true)}
                    variant="outline"
                    size="icon"
                    className="rounded-full flex-shrink-0"
                    aria-label="Pest Detection"
                    disabled={isMessageLoading}
                  >
                    <Leaf className="h-5 w-5" />
                  </Button>
                  <Button
                    onClick={toggleRecording}
                    variant={isRecording ? "destructive" : "outline"}
                    size="icon"
                    className="rounded-full flex-shrink-0"
                    aria-label={isRecording ? t("stopRecording") as string : t("startRecording") as string}
                    disabled={isMessageLoading}
                  >
                    {isRecording ? (
                      <AudioWaveform isActive={isRecording} audioLevel={audioLevel} />
                    ) : (
                      <Mic className="h-5 w-5" />
                    )}
                  </Button>
                  <Button
                    onClick={handleSendMessage}
                    disabled={inputValue.trim() === "" || isMessageLoading}
                    variant="default"
                    size="icon"
                    className="rounded-full flex-shrink-0"
                    aria-label={t("send") as string}
                  >
                    <Send className="h-5 w-5" />
                  </Button>
                </div>
                <div className="text-[10px] text-muted-foreground text-center mt-2 flex items-center justify-center">
                  <Info className="h-3 w-3 mr-1 inline-block" />
                  {(t("disclaimerText") as string) || "Vistaar is AI and can make mistakes. Please verify sources."}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      <FeedbackForm
        showFeedbackDialog={showFeedbackDialog}
        setShowFeedbackDialog={setShowFeedbackDialog}
        feedbackText={feedbackText}
        setFeedbackText={setFeedbackText}
        feedbackOptions={feedbackOptions}
        isFeedbackRecording={isFeedbackRecording}
        toggleFeedbackRecording={toggleFeedbackRecording}
        feedbackAudioLevel={feedbackAudioLevel}
        submitFeedback={submitFeedback}
      />
      <PestDetectionDialog
        open={showPestDetectionDialog}
        onOpenChange={setShowPestDetectionDialog}
        onSubmit={handlePestDetectionSubmit}
        isSubmitting={isPestDetectionSubmitting}
      />
    </div>
  );
}
