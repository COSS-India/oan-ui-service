import React from "react";
import apiService from "@/lib/api";

export default function RecaptchaTokenDemo() {
  const handleGetToken = async () => {
    try {
      const token = await apiService.fetchAuthToken("demo-metadata");
      alert("Received chatbot token: " + token);
    } catch (e) {
      alert("Failed: " + e);
    }
  };

  return (
    <div>
      <button onClick={handleGetToken}>Get Chatbot Token (with reCAPTCHA)</button>
    </div>
  );
}
