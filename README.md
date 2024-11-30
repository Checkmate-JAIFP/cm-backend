# Checkmate: AI powered, real-time fact checking

Misinformation is a critical issue for newsrooms across the globe. The requirement on journalists to verify news escalated significantly in 2024 with elections taking place worldwide. Fact-checking is a labour intensive and time consuming process, so we sought a solution that could streamline those efforts, whilst still leaving the ultimate editorial judgement in the hands of the journalists.

This is the basis of Checkmate - a fact-checking system which can identify claims in real-time on live stream broadcasts, to enable journalists to respond quickly and accurately. 

Checkmate is an international collaborative project, brought together by the [JournalismAI Fellowship](https://www.journalismai.info/programmes/fellowship), that shares expertise from the BBC, dpa Deutsche Presse-Agentur, DataCrítica, The Sun and The Times. Arne Beckman, Manja Borchert, Nadine Forshaw, Gibran Mena, Tom Potter and Luke Sikkema are the team members working on the Checkmate project.

## Breaking down the functions:
For Checkmate to function,we needed to develop four individual elements, which formed the initial scope for the project:

Step 1: Transcription
Checkmate transcribes audio almost in real-time, using the external transcription service from AssemblyAI. There is a slight delay of approximately 20 to 30 seconds.

Step 2: Claim identification
Using the capabilities of OpenAIs GPT models, Checkmate identifies the ‘claims’ and marks them within the transcript.

Step 3: Cross referencing
The detected ‘claims’ get cross referenced against existing claims both in the Google Fact Check Explorer API and also own sources.

Step 3: Editing
The results get presented to the editor, who is able to modify, delete and add ‘claims’ to the transcription. Also annotations can be made, improving the collaboration with other team members.

## Refining the scope
As part of the ideation we spoke to journalists and prospective users to gather feedback on how they would expect this kind of tool to look and behave. 56% of users shared that they wanted to receive their transcription direct within the tool, and 96% highlighted that they would prioritise accuracy, over speed, for their transcription. We utilised this valuable feedback to inform the front end designs and it enabled us to validate difficult development decisions, including delaying the transcription by breaking the audio into chunks, to increase the accuracy of the returned transcription. 

## How Checkmate works under the hood 
Checkmate is designed as an AWS cloud application that supports collaborative work since all alterations to the current project are synced immediately which allows instant usage by colleagues.

This approach also minimises the risk of data loss, since all of the underlying logic is processed by the cloud service. If the recording at the editors’ device gets interrupted (for example due to a bad network or a dying battery) all previous progress is already available in the cloud. The data chunks of the live recording get transferred to the system every single second and then get processed.

Making use of external systems the spoken word gets transcribed, possible claims are detected and compared to similar claims using embeddings. All information gets back to the editor as soon as they are available.

All connected external services are exchangeable easily. A newsroom could decide to replace AssemblyAI by another transcription service, for example if the service delivers better results in other languages than English or if another service is already in use.

Also the claim identification module can be altered. Not only the prompt but also the underlying executing language model from OpenAI can be replaced by competitors.

By default, the Google Fact Check API is connected to the service. Other services and own databases can extend the experience of Checkmate. 

## User feedback 
We carried out extensive user testing for a variety of roles in the newsroom, which provided a range of feedback from editorial staff “Wow, that is just so clever. Just in general, the almost live transcribing is just really cool to have. So simple but so helpful.”. Whilst the feedback was primarily positive with 80% of users feeling confident in using Checkmate as their fact checking tool, it also highlighted opportunities for the tool to develop further. This included requests to expand the number of sources cited to a minimum 2-3 per claim, and to provide trust scores for sources. 

## Future of Checkmate 
The next focus for Checkmate will be to make iterative improvements, to expand the fact checking knowledge base, include recorded video and audio, expand the options for inputting a live stream and introduce a feedback loop so journalists can contribute to the system. There is appetite from dpa and newsrooms to continue this project and migrate Checkmate from an early PoC into a reliable factchecking tool.
