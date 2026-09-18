import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />);
    expect(screen.getByText('RepoPilot')).toBeInTheDocument();
  });

  it('shows Overview page on default route', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getByText('RepoPilot')).toBeInTheDocument();
  });

  it('navigation to /risks works', () => {
    window.history.pushState({}, '', '/risks');
    render(<App />);
    expect(screen.getByText('RepoPilot')).toBeInTheDocument();
  });

  it('navigation to /pull-requests works', () => {
    window.history.pushState({}, '', '/pull-requests');
    render(<App />);
    expect(screen.getByText('RepoPilot')).toBeInTheDocument();
  });
});
