export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastInput = {
  message: string;
  tone?: 'neutral' | 'error';
  action?: ToastAction;
};

export type ToastItem = ToastInput & { id: number };

export type ToastApi = {
  show: (toast: ToastInput) => void;
};
