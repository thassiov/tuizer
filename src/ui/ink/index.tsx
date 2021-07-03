import React, { FC, useEffect, useState } from 'react';
import { render } from 'ink';

import Main from './views/main';

import Manifests from './views/manifests';
import {IJSONConfigFile} from '../definitions/IJSONConfigFile';

import CommandsService from '../services/commands';

type ChoosenManifest = IJSONConfigFile;

type FirstComponentProps = {
  manifestFromCli?: ChoosenManifest;
};

const FirstComponent: FC<FirstComponentProps> = ({ manifestFromCli }: FirstComponentProps) => {
  const [manifest, setManifest] = useState({} as ChoosenManifest);
  const [pickManifest, setPickManifest] = useState(true);
  const [commandsService, setCommandsService] = useState(new CommandsService([]));

  const goPickManifest = () => setPickManifest(true);
  // maybe donePickingManifest is a better name for state than a method
  const donePickingManifest = () => setPickManifest(false);

  useEffect(() => {
    if (manifestFromCli) {
      setManifest(manifestFromCli);
      donePickingManifest();
    }

    if (!pickManifest) {
      setCommandsService(new CommandsService(manifest.commands));
    }
  }, [pickManifest]);

  return (
    <>
    {
      pickManifest ?
        <Manifests setManifest={setManifest} donePickingManifest={donePickingManifest} />
        :
        <Main name={manifest.name || 'tuizer'} commandsService={commandsService} goPickManifest={goPickManifest} />
    }
    </>
  );
}

// receive a manifest path in the function
function renderUi(manifestFromCli?: ChoosenManifest): void {
  render(<FirstComponent manifestFromCli={manifestFromCli} />);
}

export {
  renderUi,
};