"use client"

import Link from 'next/link';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { SignInButton, SignedIn, SignedOut, UserButton, useAuth } from '@clerk/nextjs';
import { fetchEventSource } from '@microsoft/fetch-event-source';

function IdeaGenerator() {
  const { getToken } = useAuth();
  const [idea, setIdea] = useState<string>('…loading');

  useEffect(() => {
    let buffer = '';

    (async () => {
      try {
        const jwt = await getToken();

        if (!jwt) {
          setIdea('Authentication required');
          return;
        }

        await fetchEventSource('/api', {
          headers: {
            Authorization: `Bearer ${jwt}`
          },

          onmessage(ev) {
            buffer += ev.data;
            setIdea(buffer);
          },

          onerror(err) {
            console.error('SSE error:', err);
            setIdea('Error generating idea. Please check the browser console.');
            throw err;
          },

          onclose() {
            console.log('SSE connection closed');
          },

          async onopen(response) {
            console.log('API response:', response.status, response.statusText);

            if (!response.ok) {
              throw new Error(
                `API returned ${response.status}: ${response.statusText}`
              );
            }
          }
        });

      } catch (err) {
        console.error('Generation failed:', err);
        setIdea(
          `Error generating idea: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    })();
  }, [getToken]);

  return (
    <div className="container mx-auto px-4 py-12">

      <nav className="flex justify-between items-center mb-12">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-200">
          IdeaGen Pro
        </h1>

        <div className="flex items-center gap-4">
          <Link
            href="/product"
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg transition-colors"
          >
            Plans
          </Link>

          <UserButton showName={true} />
        </div>
      </nav>

      <header className="text-center mb-12">
        <h2 className="text-5xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-4">
          Business Idea Generator
        </h2>

        <p className="text-gray-600 dark:text-gray-400 text-lg">
          AI-powered innovation at your fingertips
        </p>
      </header>

      <div className="max-w-3xl mx-auto">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">

          {idea === '…loading' ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-pulse text-gray-400">
                Generating your business idea...
              </div>
            </div>
          ) : (
            <div className="markdown-content text-gray-700 dark:text-gray-300">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
              >
                {idea}
              </ReactMarkdown>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">

      {/* Signed-out landing page */}
      <SignedOut>
        <div className="container mx-auto px-4 py-12">

          <nav className="flex justify-between items-center mb-12">
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-200">
              IdeaGen Pro
            </h1>

            <SignInButton mode="modal">
              <button className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg transition-colors">
                Sign In
              </button>
            </SignInButton>
          </nav>

          <div className="text-center py-24">

            <h2 className="text-6xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-6">
              Generate Your Next
              <br />
              Big Business Idea
            </h2>

            <p className="text-xl text-gray-600 dark:text-gray-400 mb-8 max-w-2xl mx-auto">
              Harness the power of AI to discover innovative business opportunities tailored for the AI agent economy
            </p>

            <SignInButton mode="modal">
              <button className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-4 px-8 rounded-xl text-lg transition-all transform hover:scale-105">
                Start Your Free Trial
              </button>
            </SignInButton>

          </div>
        </div>
      </SignedOut>

      {/* Signed-in users go directly to the app */}
      <SignedIn>
        <IdeaGenerator />
      </SignedIn>

    </main>
  );
}