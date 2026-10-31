import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './ui/Icon';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error de interfaz', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fatal-error">
          <span className="fatal-error-icon">
            <Icon name="alert" size={28} />
          </span>
          <h1>Algo se salió de cauce</h1>
          <p>
            La interfaz encontró un error inesperado. Tus datos locales no se
            tocaron.
          </p>
          <code>{this.state.message}</code>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            <Icon name="refresh" size={15} />
            Recargar FlowManager
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
