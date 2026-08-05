import * as React from 'react';

interface EmailTemplateProps {
  firstName: string;
  personalLine?: string;
  portfolioLink?: string;
  loomLink?: string;
  bodyContent?: string;
}

export const EmailTemplate: React.FC<Readonly<EmailTemplateProps>> = ({
  firstName,
  personalLine,
  portfolioLink,
  loomLink,
  bodyContent,
}) => (
  <div
    style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '14px',
      lineHeight: '1.6',
      color: '#333',
    }}
  >
    <p>Hi {firstName},</p>
    {personalLine && <p>{personalLine}</p>}
    {bodyContent && (
      <div dangerouslySetInnerHTML={{ __html: bodyContent }} />
    )}
    {portfolioLink && (
      <p>
        Check out our portfolio:{' '}
        <a href={portfolioLink} style={{ color: '#2563eb' }}>
          View Portfolio
        </a>
      </p>
    )}
    {loomLink && (
      <p>
        I recorded a quick walkthrough for you:{' '}
        <a href={loomLink} style={{ color: '#2563eb' }}>
          Watch Loom
        </a>
      </p>
    )}
    <p>Would love to chat if anything catches your eye.</p>
    <p>
      Best,
      <br />
      Varshith
    </p>
  </div>
);

export default EmailTemplate;
