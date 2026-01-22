'use client';

import React, { useState, useEffect } from 'react';
import { Upload, Play, Clock, CheckCircle, XCircle, AlertCircle, RefreshCw } from 'lucide-react';

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [ratio, setRatio] = useState('16:9');
  const [duration, setDuration] = useState('4s');

  const [learningStatus, setLearningStatus] = useState({ hasUpload: false, hasGenerate: false });
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const API_URL = 'http://localhost:3001/api';

  useEffect(() => {
    fetchStatus();
    fetchJobs();
    const interval = setInterval(fetchJobs, 2000); // Live poll
    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/templates/status`);
      const data = await res.json();
      setLearningStatus(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${API_URL}/jobs`);
      const data = await res.json();
      setJobs(data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt) return alert('Prompt is required');

    setLoading(true);
    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('ratio', ratio);
    formData.append('duration', duration);
    if (image) {
      formData.append('reference_image', image);
    }

    try {
      await fetch(`${API_URL}/jobs`, {
        method: 'POST',
        body: formData,
      });
      setPrompt('');
      setImage(null);
      fetchJobs();
    } catch (err) {
      alert('Error creating job');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen p-8 bg-gray-50 text-gray-900">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">

        {/* Left Column: Controls */}
        <div className="space-y-6">
          <header>
            <h1 className="text-3xl font-bold mb-2">Veo Studio</h1>
            <p className="text-gray-500">Local Automation Suite</p>
          </header>

          {/* Learning Status */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-semibold mb-4 flex items-center">
              <RefreshCw className="w-5 h-5 mr-2" />
              Learning Status
            </h2>
            <div className="flex space-x-4">
              <StatusBadge label="Upload Template" active={learningStatus.hasUpload} />
              <StatusBadge label="Generate Template" active={learningStatus.hasGenerate} />
            </div>
            <button
              onClick={fetchStatus}
              className="mt-4 text-sm text-blue-600 hover:underline"
            >
              Refresh Status
            </button>
          </div>

          {/* Job Form */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-semibold mb-4 flex items-center">
              <Play className="w-5 h-5 mr-2" />
              New Job
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Prompt</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  rows={4}
                  placeholder="Describe your video..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reference Image (Optional)</label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:bg-gray-50 transition cursor-pointer relative">
                  <input
                    type="file"
                    onChange={(e) => setImage(e.target.files?.[0] || null)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    accept="image/*"
                  />
                  <div className="flex flex-col items-center">
                    <Upload className="w-8 h-8 text-gray-400 mb-2" />
                    <span className="text-sm text-gray-500">
                      {image ? image.name : "Click to upload image"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Aspect Ratio</label>
                  <select
                    value={ratio}
                    onChange={(e) => setRatio(e.target.value)}
                    className="w-full p-2 border rounded-lg"
                  >
                    <option value="16:9">16:9 (Landscape)</option>
                    <option value="9:16">9:16 (Portrait)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Duration</label>
                  <select
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="w-full p-2 border rounded-lg"
                  >
                    <option value="4s">4 Seconds</option>
                    <option value="8s">8 Seconds</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50"
              >
                {loading ? 'Queuing...' : 'Queue Job'}
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: Queue */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-full">
            <h2 className="text-lg font-semibold mb-4 flex items-center">
              <Clock className="w-5 h-5 mr-2" />
              Job Queue
            </h2>

            <div className="space-y-3">
              {jobs.length === 0 ? (
                <p className="text-gray-400 text-center py-8">No jobs in queue</p>
              ) : (
                jobs.map((job) => (
                  <JobCard key={job.id} job={job} />
                ))
              )}
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}

function StatusBadge({ label, active }: { label: string, active: boolean }) {
  return (
    <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-sm ${active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {active ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
      <span>{label}</span>
    </div>
  );
}

function JobCard({ job }: { job: any }) {
  const settings = JSON.parse(job.settings);

  return (
    <div className="border rounded-lg p-4 flex items-start space-x-4 bg-gray-50">
      <div className="flex-1">
        <div className="flex justify-between items-start mb-2">
          <span className={`text-xs font-bold px-2 py-1 rounded ${
            job.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
            job.status === 'FAILED' ? 'bg-red-100 text-red-800' :
            job.status === 'PROCESSING' ? 'bg-yellow-100 text-yellow-800' :
            'bg-gray-200 text-gray-800'
          }`}>
            {job.status}
          </span>
          <span className="text-xs text-gray-400">{new Date(job.created_at).toLocaleTimeString()}</span>
        </div>
        <p className="text-sm font-medium mb-1 line-clamp-2">{job.prompt}</p>
        <div className="flex items-center space-x-3 text-xs text-gray-500">
          <span>{settings.ratio}</span>
          <span>•</span>
          <span>{settings.duration}</span>
          {job.reference_image_path && (
            <>
              <span>•</span>
              <span className="flex items-center"><Upload className="w-3 h-3 mr-1" /> Image</span>
            </>
          )}
        </div>
        {job.result_path && (
          <div className="mt-3">
             {/* If result_path is a URL, show link or video */}
             <a href={job.result_path} target="_blank" rel="noopener noreferrer" className="text-blue-600 text-sm hover:underline">
               View Result
             </a>
          </div>
        )}
      </div>
    </div>
  );
}
