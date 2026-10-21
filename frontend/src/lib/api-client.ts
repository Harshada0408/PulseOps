import axios from 'axios';
import { getApiV1BaseUrl } from './api-url';

const api = axios.create({
  baseURL: getApiV1BaseUrl(),
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor
api.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // If the error is 401 (Unauthorized) and we haven't tried to refresh yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshToken = typeof window !== 'undefined' ? localStorage.getItem('refresh_token') : null;
      if (!refreshToken) {
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }

      try {
        const { data } = await api.post('/auth/refresh', { refresh_token: refreshToken });
        const newAccessToken = data?.session?.access_token;
        if (!newAccessToken) {
          throw new Error('No access token in refresh response');
        }
        if (typeof window !== 'undefined') {
          localStorage.setItem('access_token', newAccessToken);
          if (data.session.refresh_token) {
            localStorage.setItem('refresh_token', data.session.refresh_token);
          }
        }
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      }
    }

    const backendMessage =
      error.response?.data?.error ||
      error.response?.data?.details?.[0]?.message ||
      (error.response
        ? `Request failed with status code ${error.response.status}`
        : error.message || 'Network error');

    return Promise.reject(new Error(backendMessage));
  }
);

export { api };